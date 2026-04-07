// ============================================================================
// Funding Operations — @lpcli/core
//
// Orchestrates the swap + LP lifecycle:
//   open:  funding token → swap to pool tokens → open position
//   close: close position → swap proceeds back to funding token
//   claim: claim fees → swap fee tokens back to funding token
//
// Design: no hardcoded mints or decimals. Everything is resolved from pool
// metadata and config. Split ratio is parameterised (default 0.5 for spot).
// ============================================================================

import type { LPCLIConfig } from './config.js';
import { SOL_MINT, LAMPORTS_PER_SOL, feeReserveLamports } from './config.js';
import type { WalletService, WalletBalances } from './wallet.js';
import type { DLMMService } from './dlmm.js';
import type {
  PoolMeta,
  SwapStep,
  FundedOpenResult,
  FundedCloseResult,
  FundedClaimResult,
} from './types.js';
import { jupiterSwap } from './jup.js';
import type { JupiterSwapResult } from './jup.js';
import { TransactionError } from './errors.js';

// ============================================================================
// Split Calculation
// ============================================================================

export interface LiquiditySplit {
  /** UI amount of token X to deposit. */
  amountX: number;
  /** UI amount of token Y to deposit. */
  amountY: number;
}

/**
 * Calculate how to split a funding-token budget into pool token amounts.
 *
 * @param totalRaw       Total budget in funding token's smallest unit.
 * @param fundingMint    Funding token mint address.
 * @param fundingDecimals Funding token decimals.
 * @param poolMeta       On-chain pool metadata (mints, active price).
 * @param ratioX         Fraction allocated to token X (0.0–1.0). Default 0.5.
 *
 * `activePrice` is the price of token X in terms of token Y.
 *
 * Example: pool = SOL/USDC, price = 140, funding = USDC, budget = 200 USDC
 *   ratioX = 0.5 → 100 USDC worth of SOL = 100/140 ≈ 0.714 SOL, 100 USDC
 */
export function calculateSplit(
  totalRaw: number,
  fundingMint: string,
  fundingDecimals: number,
  poolMeta: PoolMeta,
  ratioX = 0.5,
): LiquiditySplit {
  const ratioY = 1 - ratioX;
  const totalUi = totalRaw / 10 ** fundingDecimals;
  const price = poolMeta.activePrice; // X in terms of Y

  // Express budget in token-Y units so the price math is consistent.
  let budgetInY: number;

  if (fundingMint === poolMeta.tokenYMint) {
    // Funding IS token Y (e.g. USDC in SOL/USDC) — direct.
    budgetInY = totalUi;
  } else if (fundingMint === poolMeta.tokenXMint) {
    // Funding IS token X (e.g. SOL in SOL/USDC) — convert via price.
    budgetInY = totalUi * price;
  } else {
    // Funding is neither pool token — treat as USD-equivalent proxy for Y.
    budgetInY = totalUi;
  }

  // Target amounts in UI units.
  const targetYUi = budgetInY * ratioY;
  const targetXUi = (budgetInY * ratioX) / price;

  return {
    amountX: targetXUi,
    amountY: targetYUi,
  };
}

// ============================================================================
// Swap Planning
// ============================================================================

/**
 * Given target deposit amounts (UI) and current wallet balances, plan the
 * swaps needed to reach those targets.
 *
 * All target/available values are in UI units (human-readable).
 * Output `SwapStep.amount` is in raw smallest units (lamports, etc.)
 * because Jupiter expects raw amounts.
 *
 * Rules:
 *   - If the wallet already has enough of a token, no swap for that side.
 *   - SOL balance is reduced by fee reserve before considering it available.
 *   - Swaps go through the funding token as the intermediary when the wallet
 *     has surplus funding token. For surplus pool tokens, swap directly.
 */
export function planSwaps(params: {
  targetX: number;
  targetY: number;
  balances: WalletBalances;
  poolMeta: PoolMeta;
  fundingMint: string;
  fundingDecimals: number;
  feeReserve: number;
}): SwapStep[] {
  const { targetX, targetY, balances, poolMeta, fundingMint, fundingDecimals, feeReserve } = params;
  const steps: SwapStep[] = [];

  const availableX = availableBalance(balances, poolMeta.tokenXMint, feeReserve);
  const availableY = availableBalance(balances, poolMeta.tokenYMint, feeReserve);

  const shortfallX = targetX - availableX;
  const shortfallY = targetY - availableY;

  if (shortfallX > 0 && shortfallY <= 0) {
    // Need more X — swap from funding (or surplus Y) → X.
    const source = surplusMint(fundingMint, poolMeta, availableX, availableY, targetX, targetY);
    const swapUi = convertAmount(shortfallX, poolMeta, source, poolMeta.tokenXMint);
    const decimals = mintDecimals(source, poolMeta, fundingMint, fundingDecimals);
    steps.push({ inputMint: source, outputMint: poolMeta.tokenXMint, amount: uiToRaw(swapUi, decimals) });
  } else if (shortfallY > 0 && shortfallX <= 0) {
    // Need more Y — swap from funding (or surplus X) → Y.
    const source = surplusMint(fundingMint, poolMeta, availableX, availableY, targetX, targetY);
    const swapUi = convertAmount(shortfallY, poolMeta, source, poolMeta.tokenYMint);
    const decimals = mintDecimals(source, poolMeta, fundingMint, fundingDecimals);
    steps.push({ inputMint: source, outputMint: poolMeta.tokenYMint, amount: uiToRaw(swapUi, decimals) });
  } else if (shortfallX > 0 && shortfallY > 0) {
    // Short on both — swap funding → each side.
    if (fundingMint !== poolMeta.tokenXMint) {
      const swapUi = convertAmount(shortfallX, poolMeta, fundingMint, poolMeta.tokenXMint);
      steps.push({ inputMint: fundingMint, outputMint: poolMeta.tokenXMint, amount: uiToRaw(swapUi, fundingDecimals) });
    }
    if (fundingMint !== poolMeta.tokenYMint) {
      const swapUi = convertAmount(shortfallY, poolMeta, fundingMint, poolMeta.tokenYMint);
      steps.push({ inputMint: fundingMint, outputMint: poolMeta.tokenYMint, amount: uiToRaw(swapUi, fundingDecimals) });
    }
  }

  return steps;
}

/**
 * Plan swaps to convert all non-funding tokens back to the funding token.
 * Used after close/claim.
 *
 * Rules:
 *   - Skip if the token IS the funding token.
 *   - If the token is SOL, deduct the fee reserve.
 *   - Skip if the swappable amount is zero or dust.
 */
export function planSwapBack(params: {
  balances: WalletBalances;
  tokenMints: string[];
  fundingMint: string;
  feeReserve: number;
}): SwapStep[] {
  const { balances, tokenMints, fundingMint, feeReserve } = params;
  const steps: SwapStep[] = [];
  const seen = new Set<string>();

  for (const mint of tokenMints) {
    if (mint === fundingMint || seen.has(mint)) continue;
    seen.add(mint);

    let available = rawBalance(balances, mint);

    if (mint === SOL_MINT) {
      available = Math.max(0, available - feeReserve);
    }

    if (available <= 0) continue;

    steps.push({ inputMint: mint, outputMint: fundingMint, amount: Math.floor(available) });
  }

  return steps;
}

// ============================================================================
// Execution
// ============================================================================

/**
 * Execute an array of swap steps sequentially.
 * Returns results for each successful swap.
 */
export async function executeSwaps(
  steps: SwapStep[],
  wallet: WalletService,
): Promise<JupiterSwapResult[]> {
  const results: JupiterSwapResult[] = [];

  for (const step of steps) {
    const result = await jupiterSwap(
      { inputMint: step.inputMint, outputMint: step.outputMint, amount: step.amount },
      wallet,
    );
    results.push(result);
  }

  return results;
}

// ============================================================================
// High-level Operations
// ============================================================================

/**
 * Open a position with automatic funding-token swap.
 *
 * Budget is split in funding-token units (no price math).
 * Jupiter handles the actual conversion rates.
 *
 * Flow:
 *   1. Pool metadata (mints, decimals).
 *   2. Ensure SOL for fees + rent.
 *   3. Split budget → swap to pool tokens as needed.
 *   4. Read actual balances, deposit everything.
 */
export async function fundedOpen(params: {
  pool: string;
  /** Total budget in funding token's smallest unit. */
  amount: number;
  config: LPCLIConfig;
  wallet: WalletService;
  dlmm: DLMMService;
  /** Fraction of budget allocated to token X (0.0–1.0). Default 0.5. */
  ratioX?: number;
  strategy?: 'spot' | 'bidask' | 'curve';
  widthBins?: number;
}): Promise<FundedOpenResult> {
  const { pool, amount, config, wallet, dlmm, strategy, widthBins } = params;
  const ratioX = params.ratioX ?? 0.5;
  const solReserve = feeReserveLamports(config);
  const fundingMint = config.fundingToken.mint;

  // 1. Pool metadata (cached after first call)
  const poolMeta = await dlmm.getPoolMeta(pool);
  const relevantMints = [poolMeta.tokenXMint, poolMeta.tokenYMint, fundingMint];
  const decimalsMap: Record<string, number> = {
    [poolMeta.tokenXMint]: poolMeta.tokenXDecimals,
    [poolMeta.tokenYMint]: poolMeta.tokenYDecimals,
    [fundingMint]: config.fundingToken.decimals,
  };

  // 2. Single batched RPC call for SOL + all relevant token balances.
  //    Replaces separate getBalance() + sequential getTokenAccountBalance() calls.
  const initialBal = await wallet.getMintBalances(relevantMints, decimalsMap);

  // Track balances arithmetically through swaps — no re-fetching.
  let solLamports = initialBal.solLamports;
  const tokenRaw = new Map<string, number>();
  for (const tok of initialBal.tokens) {
    tokenRaw.set(tok.mint, Number(tok.amount));
  }

  // Helper to update tracked balances from a swap result
  const applySwap = (step: SwapStep, result: JupiterSwapResult) => {
    const spent = Number(result.inputAmountResult ?? result.inAmount);
    const received = Number(result.outputAmountResult ?? result.outAmount);
    if (step.inputMint === SOL_MINT) {
      solLamports -= spent;
    } else {
      tokenRaw.set(step.inputMint, (tokenRaw.get(step.inputMint) ?? 0) - spent);
    }
    if (step.outputMint === SOL_MINT) {
      solLamports += received;
    } else {
      tokenRaw.set(step.outputMint, (tokenRaw.get(step.outputMint) ?? 0) + received);
    }
  };

  // 3. Split budget and swap to pool tokens.
  //    When one pool token IS SOL, the swap output covers both the deposit
  //    and the fee/rent reserve — deposit logic subtracts solReserve automatically.
  //    When NEITHER pool token is SOL, a separate small fee swap is needed.
  const solSideIsPoolToken =
    poolMeta.tokenXMint === SOL_MINT || poolMeta.tokenYMint === SOL_MINT;

  const allocateX = Math.floor(amount * ratioX);
  const allocateY = amount - allocateX;

  const steps: SwapStep[] = [];
  if (fundingMint !== poolMeta.tokenXMint && allocateX > 0) {
    steps.push({ inputMint: fundingMint, outputMint: poolMeta.tokenXMint, amount: allocateX });
  }
  if (fundingMint !== poolMeta.tokenYMint && allocateY > 0) {
    steps.push({ inputMint: fundingMint, outputMint: poolMeta.tokenYMint, amount: allocateY });
  }

  // Separate fee swap only when NEITHER pool token is SOL and shortfall is meaningful.
  const solShortfall = Math.max(0, solReserve - solLamports);
  if (solShortfall > 1_000_000 && !solSideIsPoolToken && fundingMint !== SOL_MINT) {
    const solNeeded = (solShortfall + 5_000_000) / LAMPORTS_PER_SOL;
    const feeAmount = Math.ceil(solNeeded * 200 * 10 ** config.fundingToken.decimals);
    steps.push({ inputMint: fundingMint, outputMint: SOL_MINT, amount: feeAmount });
  }

  const swapResults = await executeSwaps(steps, wallet);
  for (let i = 0; i < steps.length; i++) {
    applySwap(steps[i], swapResults[i]);
  }

  // 5. Compute deposit amounts.
  //    - SOL side: use swap output minus the reserve.
  //    - Funding token side (no swap happened): cap at the allocated budget.
  //    - Swapped non-SOL side: use the full swap output.
  const depositX = poolMeta.tokenXMint === SOL_MINT
    ? Math.max(0, solLamports - solReserve)
    : poolMeta.tokenXMint === fundingMint
      ? allocateX
      : Math.max(0, tokenRaw.get(poolMeta.tokenXMint) ?? 0);
  const depositY = poolMeta.tokenYMint === SOL_MINT
    ? Math.max(0, solLamports - solReserve)
    : poolMeta.tokenYMint === fundingMint
      ? allocateY
      : Math.max(0, tokenRaw.get(poolMeta.tokenYMint) ?? 0);

  // 6. Open position
  const position = await dlmm.openPosition({
    pool,
    amountX: depositX,
    amountY: depositY,
    strategy,
    widthBins,
  });

  return { swaps: swapResults, position };
}

/**
 * Close a position and swap all proceeds back to the funding token.
 *
 * 1. Close the position (withdraw all + claim fees).
 * 2. Resolve pool token mints.
 * 3. Check balances, plan swap-back, execute.
 */
export async function fundedClose(params: {
  positionAddress: string;
  pool: string;
  config: LPCLIConfig;
  wallet: WalletService;
  dlmm: DLMMService;
}): Promise<FundedCloseResult> {
  const { positionAddress, pool, config, wallet, dlmm } = params;
  const feeReserve = feeReserveLamports(config);

  // 1. Pool metadata (need mints — cached, no extra RPC if pool was used before)
  const poolMeta = await dlmm.getPoolMeta(pool);

  // 2. Close
  const close = await dlmm.closePosition(positionAddress);

  // 3. Read balances for pool tokens only (single batched RPC call)
  const decimalsMap = {
    [poolMeta.tokenXMint]: poolMeta.tokenXDecimals,
    [poolMeta.tokenYMint]: poolMeta.tokenYDecimals,
  };
  const balances = await wallet.getMintBalances([poolMeta.tokenXMint, poolMeta.tokenYMint], decimalsMap);

  // 4. Plan swap-back for both pool tokens
  const steps = planSwapBack({
    balances,
    tokenMints: [poolMeta.tokenXMint, poolMeta.tokenYMint],
    fundingMint: config.fundingToken.mint,
    feeReserve,
  });

  // 5. Execute swap-back
  const swapResults = await executeSwaps(steps, wallet);

  return { close, swaps: swapResults };
}

/**
 * Claim fees and swap them back to the funding token.
 *
 * 1. Claim fees from the position.
 * 2. Resolve pool token mints.
 * 3. Check balances, plan swap-back for fee tokens, execute.
 */
export async function fundedClaim(params: {
  positionAddress: string;
  pool: string;
  config: LPCLIConfig;
  wallet: WalletService;
  dlmm: DLMMService;
}): Promise<FundedClaimResult> {
  const { positionAddress, pool, config, wallet, dlmm } = params;
  const feeReserve = feeReserveLamports(config);

  // 1. Pool metadata (cached if pool was used before)
  const poolMeta = await dlmm.getPoolMeta(pool);
  const poolMints = [poolMeta.tokenXMint, poolMeta.tokenYMint];

  // 2. Snapshot balances before claim (single batched RPC call)
  const decimalsMap = {
    [poolMeta.tokenXMint]: poolMeta.tokenXDecimals,
    [poolMeta.tokenYMint]: poolMeta.tokenYDecimals,
  };
  const preClaim = await wallet.getMintBalances(poolMints, decimalsMap);

  // 3. Claim
  const claim = await dlmm.claimFees(positionAddress);

  // 4. Post-claim balances — diff tells us what was actually claimed
  const postClaim = await wallet.getMintBalances(poolMints, decimalsMap);

  // Only swap back the delta (what was actually received as fees)
  const deltaX = rawBalance(postClaim, poolMeta.tokenXMint) - rawBalance(preClaim, poolMeta.tokenXMint);
  const deltaY = rawBalance(postClaim, poolMeta.tokenYMint) - rawBalance(preClaim, poolMeta.tokenYMint);

  const steps: SwapStep[] = [];

  if (deltaX > 0 && poolMeta.tokenXMint !== config.fundingToken.mint) {
    let swapAmount = deltaX;
    if (poolMeta.tokenXMint === SOL_MINT) {
      swapAmount = Math.min(deltaX, Math.max(0, postClaim.solLamports - feeReserve));
    }
    if (swapAmount > 0) {
      steps.push({ inputMint: poolMeta.tokenXMint, outputMint: config.fundingToken.mint, amount: Math.floor(swapAmount) });
    }
  }

  if (deltaY > 0 && poolMeta.tokenYMint !== config.fundingToken.mint) {
    let swapAmount = deltaY;
    if (poolMeta.tokenYMint === SOL_MINT) {
      swapAmount = Math.min(deltaY, Math.max(0, postClaim.solLamports - feeReserve));
    }
    if (swapAmount > 0) {
      steps.push({ inputMint: poolMeta.tokenYMint, outputMint: config.fundingToken.mint, amount: Math.floor(swapAmount) });
    }
  }

  const swapResults = await executeSwaps(steps, wallet);

  return { claim, swaps: swapResults };
}

// ============================================================================
// Internal Helpers
// ============================================================================


/**
 * Get the available balance for a mint, with SOL fee reserve deducted
 * when applicable. Returns UI-adjusted amount.
 */
function availableBalance(balances: WalletBalances, mint: string, feeReserve: number): number {
  if (mint === SOL_MINT) {
    return Math.max(0, balances.solBalance - feeReserve / LAMPORTS_PER_SOL);
  }
  const token = balances.tokens.find((t) => t.mint === mint);
  return token?.uiAmount ?? 0;
}

/**
 * Get the raw (smallest-unit) balance for a mint.
 */
function rawBalance(balances: WalletBalances, mint: string): number {
  if (mint === SOL_MINT) {
    return balances.solLamports;
  }
  const token = balances.tokens.find((t) => t.mint === mint);
  return token ? Number(token.amount) : 0;
}

/**
 * Convert a UI amount to raw smallest-unit amount.
 * Uses token decimals from the wallet balances, falling back to common defaults.
 */
function toRaw(uiAmount: number, mint: string, balances: WalletBalances): number {
  if (mint === SOL_MINT) {
    return Math.floor(uiAmount * LAMPORTS_PER_SOL);
  }
  const token = balances.tokens.find((t) => t.mint === mint);
  const decimals = token?.decimals ?? 6;
  return Math.floor(uiAmount * 10 ** decimals);
}

/**
 * Determine which mint to swap FROM to cover a shortfall.
 * Prefers the side with surplus; falls back to the funding token.
 */
function surplusMint(
  fundingMint: string,
  poolMeta: PoolMeta,
  availableX: number,
  availableY: number,
  targetX: number,
  targetY: number,
): string {
  const surplusX = availableX - targetX;
  const surplusY = availableY - targetY;

  if (surplusX > 0 && poolMeta.tokenXMint !== fundingMint) return poolMeta.tokenXMint;
  if (surplusY > 0 && poolMeta.tokenYMint !== fundingMint) return poolMeta.tokenYMint;

  return fundingMint;
}

/**
 * Convert a UI amount to raw smallest-unit amount using known decimals.
 */
function uiToRaw(uiAmount: number, decimals: number): number {
  return Math.floor(uiAmount * 10 ** decimals);
}

/**
 * Look up decimals for a mint. Checks pool meta first, then funding token,
 * falls back to SOL (9) or a conservative default (6).
 */
function mintDecimals(
  mint: string,
  poolMeta: PoolMeta,
  fundingMint: string,
  fundingDecimals: number,
): number {
  if (mint === SOL_MINT) return 9;
  if (mint === poolMeta.tokenXMint) return poolMeta.tokenXDecimals;
  if (mint === poolMeta.tokenYMint) return poolMeta.tokenYDecimals;
  if (mint === fundingMint) return fundingDecimals;
  return 6; // conservative fallback for unknown SPL tokens
}

/**
 * Estimate how much of `fromMint` (UI) is needed to get `targetAmount` (UI)
 * of `toMint`. Uses the pool's active price. Jupiter handles actual routing.
 *
 * Returns a UI amount — caller must convert to raw via uiToRaw().
 */
function convertAmount(
  targetAmountUi: number,
  poolMeta: PoolMeta,
  fromMint: string,
  toMint: string,
): number {
  const price = poolMeta.activePrice; // X in terms of Y

  // Need Y, paying with X: amount_X = amount_Y / price
  if (fromMint === poolMeta.tokenXMint && toMint === poolMeta.tokenYMint) {
    return targetAmountUi / price;
  }

  // Need X, paying with Y: amount_Y = amount_X * price
  if (fromMint === poolMeta.tokenYMint && toMint === poolMeta.tokenXMint) {
    return targetAmountUi * price;
  }

  // Same token or exotic pair — pass through.
  return targetAmountUi;
}
