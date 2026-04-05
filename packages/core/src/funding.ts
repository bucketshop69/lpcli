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
import { SOL_MINT, LAMPORTS_PER_SOL, POSITION_RENT_LAMPORTS, feeReserveLamports } from './config.js';
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
 * 1. Resolve pool metadata (mints, price).
 * 2. Calculate the target split for X and Y.
 * 3. Check wallet balances, plan & execute swaps.
 * 4. Re-check balances (use real post-swap amounts).
 * 5. Open position.
 */
export async function fundedOpen(params: {
  pool: string;
  /** Total budget in funding token's smallest unit. */
  amount: number;
  config: LPCLIConfig;
  wallet: WalletService;
  dlmm: DLMMService;
  /** Fraction of budget allocated to token X. Default 0.5 (balanced). */
  ratioX?: number;
  strategy?: 'spot' | 'bidask' | 'curve';
  widthBins?: number;
}): Promise<FundedOpenResult> {
  const { pool, amount, config, wallet, dlmm, strategy, widthBins } = params;
  const ratioX = params.ratioX ?? 0.5;
  const feeReserve = feeReserveLamports(config);
  // Reserve fee + rent for position account creation (rent is refunded on close)
  const solReserve = feeReserve + POSITION_RENT_LAMPORTS;

  // 1. Pool metadata
  const poolMeta = await dlmm.getPoolMeta(pool);

  // 2. Calculate target split (in UI amounts)
  const split = calculateSplit(amount, config.fundingToken.mint, config.fundingToken.decimals, poolMeta, ratioX);

  // 3. Check balances & plan swaps
  let balances = await wallet.getBalances();

  // If SOL is short for fees + rent, swap some funding token → SOL first
  if (balances.solLamports < solReserve) {
    const shortfallLamports = solReserve - balances.solLamports;
    // Estimate funding token needed: use pool price if available, else assume ~$100/SOL
    const solPriceEstimate = poolMeta.activePrice > 0 && poolMeta.tokenXMint === SOL_MINT
      ? poolMeta.activePrice  // SOL price in token Y (e.g. USDC)
      : 150; // conservative fallback
    const shortfallSol = shortfallLamports / LAMPORTS_PER_SOL;
    const fundingNeeded = shortfallSol * solPriceEstimate * 1.15; // 15% buffer for slippage
    const rawFunding = Math.ceil(fundingNeeded * 10 ** config.fundingToken.decimals);
    const rentSwap: SwapStep[] = [{ inputMint: config.fundingToken.mint, outputMint: SOL_MINT, amount: rawFunding }];
    await executeSwaps(rentSwap, wallet);
    balances = await wallet.getBalances();

    if (balances.solLamports < solReserve) {
      throw new TransactionError(
        `Insufficient SOL after rent swap. Have ${balances.solLamports} lamports, need ${solReserve}.`,
        'INSUFFICIENT_FEE_RESERVE',
      );
    }
  }

  const steps = planSwaps({
    targetX: split.amountX,
    targetY: split.amountY,
    balances,
    poolMeta,
    fundingMint: config.fundingToken.mint,
    fundingDecimals: config.fundingToken.decimals,
    feeReserve: solReserve,
  });

  // 4. Execute swaps
  const swapResults = await executeSwaps(steps, wallet);

  // 5. Re-read balances after swaps — use real amounts, not estimates
  const postSwapBalances = await wallet.getBalances();
  const finalX = availableBalance(postSwapBalances, poolMeta.tokenXMint, solReserve);
  const finalY = availableBalance(postSwapBalances, poolMeta.tokenYMint, solReserve);

  // Use the lesser of target and available (don't overshoot)
  const depositX = Math.min(split.amountX, finalX);
  const depositY = Math.min(split.amountY, finalY);

  // Convert UI amounts to raw for the SDK
  const rawDepositX = toRaw(depositX, poolMeta.tokenXMint, postSwapBalances);
  const rawDepositY = toRaw(depositY, poolMeta.tokenYMint, postSwapBalances);

  // 6. Open position
  const position = await dlmm.openPosition({
    pool,
    amountX: rawDepositX,
    amountY: rawDepositY,
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

  // 1. Close
  const close = await dlmm.closePosition(positionAddress);

  // 2. Pool metadata (need mints for swap-back)
  const poolMeta = await dlmm.getPoolMeta(pool);

  // 3. Read actual balances after close
  const balances = await wallet.getBalances();

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

  // 1. Snapshot balances before claim
  const preClaim = await wallet.getBalances();

  // 2. Claim
  const claim = await dlmm.claimFees(positionAddress);

  // 3. Pool metadata
  const poolMeta = await dlmm.getPoolMeta(pool);

  // 4. Post-claim balances — diff tells us what was actually claimed
  const postClaim = await wallet.getBalances();

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
