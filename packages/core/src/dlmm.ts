// ============================================================================
// DLMM Service (SDK Wrapper) — @lpcli/core
//
// Optimised for minimal RPC usage:
//   - DLMM instances cached per pool address (single DLMM.create per pool)
//   - refetchStates() for lightweight refreshes (no full re-create)
//   - Single Connection reused across all methods
//   - Websocket tx confirmation with automatic polling fallback
//   - Transaction retries with exponential backoff
//   - Scoped position lookup when pool is known
// ============================================================================

// SDK note: @meteora-ag/dlmm@1.9.4 ships a CJS bundle whose ESM entry
// eagerly imports @coral-xyz/anchor which lacks proper ESM named exports.
// ALL SDK imports MUST be lazy (dynamic import) to avoid top-level crashes
// when this module is loaded by tsx or Node ESM.
import type { LbPosition, PositionInfo } from '@meteora-ag/dlmm';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';

import type { OpenPositionResult, ClosePositionResult, Position, PoolMeta } from './types.js';
import { NetworkError, TransactionError } from './errors.js';
import type { WalletService } from './wallet.js';
import type { TokenRegistry } from './tokens.js';

// ============================================================================
// SDK lazy loader
// ============================================================================

type BNType = { toNumber(): number; toString(): string };
type BNConstructor = new (value: number | string) => BNType;

const STRATEGY_TYPE = { Spot: 0, Curve: 1, BidAsk: 2 } as const;

interface SDKBundle {
  dlmm: DLMMClassType;
  BN: BNConstructor;
  getPriceOfBinByBinId: (binId: number, binStep: number) => { toString(): string };
}

type DLMMClassType = {
  create(connection: Connection, pool: PublicKey, opt?: { cluster?: string }): Promise<DLMMInstance>;
  getAllLbPairPositionsByUser(
    connection: Connection,
    userPubKey: PublicKey,
    opt?: { cluster?: string }
  ): Promise<Map<string, PositionInfo>>;
};

let _sdk: SDKBundle | null = null;

async function getSDK(): Promise<SDKBundle> {
  if (_sdk) return _sdk;
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dlmmMod = require('@meteora-ag/dlmm') as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anchorMod = require('@coral-xyz/anchor') as any;
  const dlmm = (dlmmMod.default ?? dlmmMod) as DLMMClassType;
  const BN = ((anchorMod.default ?? anchorMod).BN ?? anchorMod.BN) as BNConstructor;
  const getPriceOfBinByBinId = (dlmmMod.getPriceOfBinByBinId ?? dlmmMod.default?.getPriceOfBinByBinId) as SDKBundle['getPriceOfBinByBinId'];
  _sdk = { dlmm, BN, getPriceOfBinByBinId };
  return _sdk;
}

// ============================================================================
// DLMM instance type (subset we use)
// ============================================================================

interface DLMMInstance {
  lbPair: {
    activeId: number;
    binStep: number;
  };
  tokenX: { mint: { address: PublicKey; decimals: number } };
  tokenY: { mint: { address: PublicKey; decimals: number } };
  getActiveBin(): Promise<{
    binId: number;
    price: string;
    pricePerToken: string;
  }>;
  refetchStates(): Promise<void>;
  getPositionsByUserAndLbPair(
    userPubKey?: PublicKey,
  ): Promise<{
    activeBin: { binId: number; price: string; pricePerToken: string };
    userPositions: LbPosition[];
  }>;
  getPosition(positionPubKey: PublicKey): Promise<LbPosition>;
  initializePositionAndAddLiquidityByStrategy(params: {
    positionPubKey: PublicKey;
    totalXAmount: BNType;
    totalYAmount: BNType;
    strategy: { minBinId: number; maxBinId: number; strategyType: number };
    user: PublicKey;
    slippage?: number;
  }): Promise<Transaction>;
  addLiquidityByStrategy(params: {
    positionPubKey: PublicKey;
    totalXAmount: BNType;
    totalYAmount: BNType;
    strategy: { minBinId: number; maxBinId: number; strategyType: number };
    user: PublicKey;
    slippage?: number;
  }): Promise<Transaction>;
  removeLiquidity(params: {
    user: PublicKey;
    position: PublicKey;
    fromBinId: number;
    toBinId: number;
    bps: BNType;
    shouldClaimAndClose?: boolean;
  }): Promise<Transaction[]>;
  claimSwapFee(params: {
    owner: PublicKey;
    position: LbPosition;
  }): Promise<Transaction[]>;
}

// ============================================================================
// Constants
// ============================================================================

export interface DLMMServiceOptions {
  /** Primary RPC — used for transaction sending & confirmation. */
  rpcUrl: string;
  /** Read-only RPC — used for DLMM.create, refetchStates, getActiveBin. Defaults to rpcUrl. */
  readRpcUrl?: string;
  wallet: WalletService;
  cluster: 'mainnet' | 'devnet';
  /** Token registry for resolving symbols. If omitted, mints are truncated. */
  tokenRegistry?: TokenRegistry;
}

/** Map our config cluster names to what the DLMM SDK expects. */
const SDK_CLUSTER: Record<string, string> = {
  mainnet: 'mainnet-beta',
  devnet: 'devnet',
};

/** Default confirmation timeout (ms). */
const CONFIRM_TIMEOUT_MS = 30_000;

/** Max transaction retry attempts. */
const MAX_RETRIES = 3;

/** Default slippage percentage for LP operations. */
const DEFAULT_SLIPPAGE = 1;

/** Max slippage percentage (auto-escalation ceiling). */
const MAX_SLIPPAGE = 10;

// ============================================================================
// Helpers
// ============================================================================

export function toStrategyType(strategy: 'spot' | 'bidask' | 'curve'): number {
  switch (strategy) {
    case 'bidask': return STRATEGY_TYPE.BidAsk;
    case 'curve':  return STRATEGY_TYPE.Curve;
    case 'spot':
    default:       return STRATEGY_TYPE.Spot;
  }
}

/**
 * Derive a websocket URL from an HTTP RPC URL.
 * https:// → wss://, http:// → ws://
 */
function deriveWssUrl(httpUrl: string): string {
  return httpUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
}

/**
 * Check whether an error message indicates a retryable condition.
 */
function isRetryableError(msg: string): boolean {
  return (
    msg.includes('block height exceeded') ||
    msg.includes('expired') ||
    msg.includes('Blockhash not found') ||
    msg.includes('ExceededBinSlippageTolerance') ||
    msg.includes('Too Many Requests') ||
    msg.includes('429')
  );
}

/**
 * Check whether an error is a slippage tolerance issue.
 */
function isSlippageError(msg: string): boolean {
  return msg.includes('ExceededBinSlippageTolerance');
}

// ============================================================================
// Transaction confirmation — websocket with polling fallback
// ============================================================================

/**
 * Confirm a transaction signature.
 *
 * Strategy:
 * 1. Try websocket confirmation via onSignature (real-time push).
 * 2. If websocket fails to connect or errors out, fall back to
 *    connection.confirmTransaction (HTTP polling).
 *
 * Returns the time taken in ms (for diagnostics).
 */
async function confirmTx(
  connection: Connection,
  signature: string,
  timeoutMs = CONFIRM_TIMEOUT_MS,
): Promise<{ method: 'websocket' | 'polling'; durationMs: number }> {
  const start = Date.now();

  try {
    // Attempt websocket confirmation
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Websocket confirmation timeout')),
        timeoutMs,
      );

      const subId = connection.onSignature(
        signature,
        (result) => {
          clearTimeout(timer);
          if (result.err) {
            reject(
              new TransactionError(
                `Transaction failed on-chain: ${JSON.stringify(result.err)}`,
                'ON_CHAIN_FAILURE',
              ),
            );
          } else {
            resolve();
          }
        },
        'confirmed',
      );

      // If the subscription itself errors, the timer will fire and we fall back
      void subId; // keep reference to avoid GC
    });

    return { method: 'websocket', durationMs: Date.now() - start };
  } catch (wsErr) {
    // On-chain failures should not fall back — they'll fail on polling too
    if (wsErr instanceof TransactionError) throw wsErr;

    // Websocket failed (timeout, connection issue) — fall back to polling
    try {
      const latestBlockhash = await connection.getLatestBlockhash('confirmed');
      await connection.confirmTransaction(
        { signature, ...latestBlockhash },
        'confirmed',
      );
      return { method: 'polling', durationMs: Date.now() - start };
    } catch (pollErr) {
      throw new NetworkError(
        `Transaction confirmation failed (ws: ${wsErr instanceof Error ? wsErr.message : String(wsErr)}, poll: ${pollErr instanceof Error ? pollErr.message : String(pollErr)})`,
        pollErr,
      );
    }
  }
}

// ============================================================================
// Sign, send, and confirm
// ============================================================================

/**
 * Sign a transaction, send it, and confirm via websocket (with polling fallback).
 */
export async function signSendConfirm(
  tx: Transaction,
  wallet: WalletService,
  connection: Connection,
): Promise<{ signature: string; confirmMethod: 'websocket' | 'polling'; confirmMs: number }> {
  let signed: Transaction;
  try {
    signed = await wallet.signTx(tx);
  } catch (err: unknown) {
    throw new TransactionError(
      `Failed to sign transaction: ${err instanceof Error ? err.message : String(err)}`,
      'SIGN_FAILURE',
      err,
    );
  }

  let signature: string;
  try {
    signature = await connection.sendRawTransaction(signed.serialize());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('timeout')) {
      throw new NetworkError(`RPC send failed: ${msg}`, err);
    }
    throw new TransactionError(`Transaction failed: ${msg}`, 'SEND_FAILURE', err);
  }

  const confirm = await confirmTx(connection, signature);

  return { signature, confirmMethod: confirm.method, confirmMs: confirm.durationMs };
}

// Keep backward-compat export (returns just the signature string)
export async function signAndSend(
  tx: Transaction,
  wallet: WalletService,
  connection: Connection,
): Promise<string> {
  const result = await signSendConfirm(tx, wallet, connection);
  return result.signature;
}

// ============================================================================
// DLMMService
// ============================================================================

export class DLMMService {
  /** Read-only connection — DLMM.create, refetchStates, getActiveBin, position lookups. */
  private _readConnection: Connection;
  /** Send connection — transaction sending & websocket confirmation. */
  private _sendConnection: Connection;
  private _poolCache = new Map<string, DLMMInstance>();
  /** Tracks pools that were just created (fresh state, no refetch needed). */
  private _freshPools = new Set<string>();
  /** Timestamp of last heavy RPC operation — used to throttle bursts. */
  private _lastRpcTs = Date.now();

  constructor(private _options: DLMMServiceOptions) {
    const readRpc = _options.readRpcUrl ?? _options.rpcUrl;
    const sendRpc = _options.rpcUrl;

    this._readConnection = new Connection(readRpc, { commitment: 'confirmed' });

    const wssUrl = deriveWssUrl(sendRpc);
    this._sendConnection = new Connection(sendRpc, {
      commitment: 'confirmed',
      wsEndpoint: wssUrl,
    });
  }

  /**
   * Ensure minimum spacing between heavy RPC operations.
   * Prevents back-to-back getMultipleAccountsInfo from triggering per-method rate limits.
   */
  private async _throttle(minGapMs = 2000): Promise<void> {
    const now = Date.now();
    const elapsed = now - this._lastRpcTs;
    if (elapsed < minGapMs) {
      await new Promise(r => setTimeout(r, minGapMs - elapsed));
    }
    this._lastRpcTs = Date.now();
  }

  // --------------------------------------------------------------------------
  // Pool instance cache
  // --------------------------------------------------------------------------

  /**
   * Get or create a cached DLMM instance for a pool.
   * First call for a pool address does DLMM.create() (heavy).
   * Subsequent calls return the cached instance.
   */
  private async _getInstance(pool: string): Promise<DLMMInstance> {
    const cached = this._poolCache.get(pool);
    if (cached) return cached;

    const sdk = await getSDK();
    let instance: DLMMInstance;
    let lastErr: Error | undefined;

    // DLMM.create() fires multiple getMultipleAccountsInfo calls internally.
    // RPCs rate-limit per-method calls — the SDK's own retry (500ms→4s) often
    // isn't enough. Our outer retry waits longer to let the window fully reset.
    const POOL_LOAD_RETRIES = 4;
    for (let attempt = 1; attempt <= POOL_LOAD_RETRIES; attempt++) {
      try {
        if (attempt > 1) {
          const delay = Math.min(5000 * attempt, 15_000);
          await new Promise((r) => setTimeout(r, delay));
        }

        await this._throttle();
        instance = await sdk.dlmm.create(this._readConnection, new PublicKey(pool), {
          cluster: SDK_CLUSTER[this._options.cluster],
        });

        this._poolCache.set(pool, instance!);
        this._freshPools.add(pool);
        return instance!;
      } catch (err: unknown) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        const msg = lastErr.message;
        const retryable = isRetryableError(msg);

        if (!retryable || attempt === POOL_LOAD_RETRIES) break;
      }
    }

    throw new NetworkError(
      `Failed to load pool ${pool}: ${lastErr?.message ?? 'unknown'}`,
      lastErr,
    );
  }

  /**
   * Refresh a cached pool's on-chain state (lightweight — no full re-create).
   * Skips refetch if the instance was just created (state is already fresh).
   */
  private async _refresh(pool: string): Promise<DLMMInstance> {
    const instance = await this._getInstance(pool);

    // Skip refetch if pool was just created — DLMM.create() already has fresh state
    if (this._freshPools.has(pool)) {
      this._freshPools.delete(pool);
      return instance;
    }

    await this._throttle();
    await instance.refetchStates();
    return instance;
  }

  /**
   * Get the raw SDK DLMM instance for a pool. Useful for debugging / inspection.
   * Uses the cache — does not create a separate instance.
   */
  async getRawInstance(pool: string): Promise<DLMMInstance> {
    return this._getInstance(pool);
  }

  /**
   * Evict a pool from the cache (e.g. if the pool state is suspected stale).
   */
  evictPool(pool: string): void {
    this._poolCache.delete(pool);
  }

  // --------------------------------------------------------------------------
  // Transaction execution with retries
  // --------------------------------------------------------------------------

  /**
   * Execute a transaction-producing function with retries and confirmation.
   *
   * On each retry: refetchStates → rebuild tx → sign → send → confirm.
   * Auto-escalates slippage on ExceededBinSlippageTolerance.
   */
  private async _executeWithRetry(
    pool: string,
    createTxFn: (instance: DLMMInstance, slippage: number) => Promise<Transaction | Transaction[]>,
    opts?: {
      extraSigners?: Keypair[];
      slippage?: number;
      maxRetries?: number;
    },
  ): Promise<string[]> {
    const wallet = this._options.wallet;
    const maxRetries = opts?.maxRetries ?? MAX_RETRIES;
    let slippage = opts?.slippage ?? DEFAULT_SLIPPAGE;
    let lastErr: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Refresh pool state before each attempt
        const instance = await this._refresh(pool);

        const txOrTxs = await createTxFn(instance, slippage);
        const txArray = Array.isArray(txOrTxs) ? txOrTxs : [txOrTxs];

        // Sign extra signers first (e.g. position keypair)
        for (const tx of txArray) {
          if (opts?.extraSigners) {
            for (const signer of opts.extraSigners) {
              tx.partialSign(signer);
            }
          }
        }

        // Send and confirm each tx sequentially (ws confirmation pipelines them)
        const signatures: string[] = [];
        for (const tx of txArray) {
          const result = await signSendConfirm(tx, wallet, this._sendConnection);
          console.log(`  tx confirmed via ${result.confirmMethod} (${result.confirmMs}ms)`);
          signatures.push(result.signature);
        }

        return signatures;
      } catch (err: unknown) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        const msg = lastErr.message;

        if (!isRetryableError(msg) || attempt === maxRetries) break;

        // Auto-escalate slippage on tolerance errors
        if (isSlippageError(msg) && slippage < MAX_SLIPPAGE) {
          slippage = Math.min(slippage * 2, MAX_SLIPPAGE);
          console.warn(`  Slippage exceeded, escalating to ${slippage}%`);
        }

        const delay = Math.min(1000 * 2 ** (attempt - 1), 5000);
        console.warn(`  Tx attempt ${attempt}/${maxRetries} failed: ${msg}. Retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    throw lastErr!;
  }

  // --------------------------------------------------------------------------
  // Pool metadata
  // --------------------------------------------------------------------------

  /**
   * Resolve on-chain pool metadata: token mints, active bin, price.
   * Uses cached instance + refetchStates (not a full re-create).
   */
  async getPoolMeta(pool: string): Promise<PoolMeta> {
    const dlmm = await this._refresh(pool);
    const activeBin = await dlmm.getActiveBin();

    // SDK's pricePerToken is already the human-readable UI price.
    // e.g. SOL/USDC: pricePerToken = "81.94" (USDC per SOL)
    const activePrice = parseFloat(activeBin.pricePerToken);

    return {
      pool,
      tokenXMint: dlmm.tokenX.mint.address.toBase58(),
      tokenYMint: dlmm.tokenY.mint.address.toBase58(),
      tokenXDecimals: dlmm.tokenX.mint.decimals,
      tokenYDecimals: dlmm.tokenY.mint.decimals,
      activeBinId: activeBin.binId,
      binStep: dlmm.lbPair.binStep,
      activePrice,
    };
  }

  // --------------------------------------------------------------------------
  // Open position
  // --------------------------------------------------------------------------

  async openPosition(params: {
    pool: string;
    amountX?: number;
    amountY?: number;
    strategy?: 'spot' | 'bidask' | 'curve';
    widthBins?: number;
    type?: 'balanced' | 'imbalanced' | 'one_sided_x' | 'one_sided_y';
  }): Promise<OpenPositionResult> {
    const sdk = await getSDK();
    const wallet = this._options.wallet;
    const userPubKey = wallet.getPublicKey();
    const strategyType = toStrategyType(params.strategy ?? 'spot');

    // Position keypair must be stable across retries
    const positionKeypair = Keypair.generate();

    // Range is computed inside the callback using the already-refreshed instance.
    // _executeWithRetry calls _refresh() before each attempt, which updates
    // lbPair.activeId — no separate getActiveBin() RPC call needed.
    let finalMinBinId = 0;
    let finalMaxBinId = 0;
    let finalBinStep = 0;

    const signatures = await this._executeWithRetry(
      params.pool,
      async (instance, slippage) => {
        const activeBinId = instance.lbPair.activeId;
        finalBinStep = instance.lbPair.binStep;
        // Max 69 bins per position. Default: use all 69 (halfWidth = 34).
        const halfWidth = params.widthBins ?? 34;
        finalMinBinId = activeBinId - halfWidth;
        finalMaxBinId = activeBinId + halfWidth;

        return instance.initializePositionAndAddLiquidityByStrategy({
          positionPubKey: positionKeypair.publicKey,
          totalXAmount: new sdk.BN(params.amountX ?? 0),
          totalYAmount: new sdk.BN(params.amountY ?? 0),
          strategy: { minBinId: finalMinBinId, maxBinId: finalMaxBinId, strategyType },
          user: userPubKey,
          slippage,
        });
      },
      { extraSigners: [positionKeypair] },
    );

    const rangeLow = parseFloat(sdk.getPriceOfBinByBinId(finalMinBinId, finalBinStep).toString());
    const rangeHigh = parseFloat(sdk.getPriceOfBinByBinId(finalMaxBinId, finalBinStep).toString());

    // Resolve token symbols and decimals from pool metadata
    const meta = await this.getPoolMeta(params.pool);
    const registry = this._options.tokenRegistry;
    const tokenXSymbol = (registry?.getCached(meta.tokenXMint)?.symbol ?? meta.tokenXMint.slice(0, 6)).toUpperCase();
    const tokenYSymbol = (registry?.getCached(meta.tokenYMint)?.symbol ?? meta.tokenYMint.slice(0, 6)).toUpperCase();
    const rawX = params.amountX ?? 0;
    const rawY = params.amountY ?? 0;

    return {
      position: positionKeypair.publicKey.toBase58(),
      range_low: rangeLow,
      range_high: rangeHigh,
      deposited_x: rawX,
      deposited_y: rawY,
      deposited_x_ui: rawX / 10 ** meta.tokenXDecimals,
      deposited_y_ui: rawY / 10 ** meta.tokenYDecimals,
      token_x_symbol: tokenXSymbol,
      token_y_symbol: tokenYSymbol,
      tx: signatures[signatures.length - 1],
    };
  }

  // --------------------------------------------------------------------------
  // Close position
  // --------------------------------------------------------------------------

  async closePosition(positionAddress: string): Promise<ClosePositionResult> {
    const sdk = await getSDK();
    const wallet = this._options.wallet;
    const userPubKey = wallet.getPublicKey();
    const positionPubKey = new PublicKey(positionAddress);

    // Find the position and its pool
    const { positionInfo, lbPosition } = await this._findPosition(positionAddress);
    const poolAddress = positionInfo.publicKey.toBase58();

    // Ensure pool is cached
    await this._getInstance(poolAddress);

    const posData = lbPosition.positionData;

    const signatures = await this._executeWithRetry(
      poolAddress,
      async (instance) => {
        return instance.removeLiquidity({
          user: userPubKey,
          position: positionPubKey,
          fromBinId: posData.lowerBinId,
          toBinId: posData.upperBinId,
          bps: new sdk.BN(10_000), // 100%
          shouldClaimAndClose: true,
        });
      },
    );

    const tokenXDecimals = positionInfo.tokenX?.mint?.decimals ?? 6;
    const tokenYDecimals = positionInfo.tokenY?.mint?.decimals ?? 6;
    const tokenXMint = positionInfo.tokenX?.mint?.address?.toBase58() ?? '';
    const tokenYMint = positionInfo.tokenY?.mint?.address?.toBase58() ?? '';
    const registry = this._options.tokenRegistry;
    const tokenXSymbol = (registry?.getCached(tokenXMint)?.symbol ?? tokenXMint.slice(0, 6)).toUpperCase();
    const tokenYSymbol = (registry?.getCached(tokenYMint)?.symbol ?? tokenYMint.slice(0, 6)).toUpperCase();

    const rawX = parseFloat(posData.totalXAmount);
    const rawY = parseFloat(posData.totalYAmount);
    const feesX = posData.feeX.toNumber();
    const feesY = posData.feeY.toNumber();

    return {
      withdrawn_x: rawX,
      withdrawn_y: rawY,
      withdrawn_x_ui: rawX / 10 ** tokenXDecimals,
      withdrawn_y_ui: rawY / 10 ** tokenYDecimals,
      claimed_fees_x: feesX,
      claimed_fees_y: feesY,
      claimed_fees_x_ui: feesX / 10 ** tokenXDecimals,
      claimed_fees_y_ui: feesY / 10 ** tokenYDecimals,
      token_x_symbol: tokenXSymbol,
      token_y_symbol: tokenYSymbol,
      tx: signatures[signatures.length - 1],
    };
  }

  // --------------------------------------------------------------------------
  // Claim fees
  // --------------------------------------------------------------------------

  /** Resolve the pool address for a given position (uses cached pools first, then global search). */
  async resolvePoolForPosition(positionAddress: string): Promise<string> {
    const { positionInfo } = await this._findPosition(positionAddress);
    return positionInfo.publicKey.toBase58();
  }

  async claimFees(positionAddress: string): Promise<{ claimedX: number; claimedY: number; tx: string; pool: string }> {
    const wallet = this._options.wallet;
    const userPubKey = wallet.getPublicKey();

    const { positionInfo, lbPosition } = await this._findPosition(positionAddress);
    const poolAddress = positionInfo.publicKey.toBase58();

    const claimedX = lbPosition.positionData.feeX.toNumber();
    const claimedY = lbPosition.positionData.feeY.toNumber();

    const signatures = await this._executeWithRetry(
      poolAddress,
      async (instance) => {
        const txs = await instance.claimSwapFee({
          owner: userPubKey,
          position: lbPosition,
        });
        if (txs.length === 0) return [];
        return txs;
      },
    );

    if (signatures.length === 0) {
      return { claimedX: 0, claimedY: 0, tx: '', pool: poolAddress };
    }

    return { claimedX, claimedY, tx: signatures[signatures.length - 1], pool: poolAddress };
  }

  // --------------------------------------------------------------------------
  // Add liquidity
  // --------------------------------------------------------------------------

  async addLiquidity(params: {
    position: string;
    amountX?: number;
    amountY?: number;
    strategy?: 'spot' | 'bidask' | 'curve';
  }): Promise<{ addedX: number; addedY: number; tx: string }> {
    const sdk = await getSDK();
    const wallet = this._options.wallet;
    const userPubKey = wallet.getPublicKey();

    const { positionInfo, lbPosition } = await this._findPosition(params.position);
    const poolAddress = positionInfo.publicKey.toBase58();
    const posData = lbPosition.positionData;
    const strategyType = toStrategyType(params.strategy ?? 'spot');

    const signatures = await this._executeWithRetry(
      poolAddress,
      async (instance, slippage) => {
        return instance.addLiquidityByStrategy({
          positionPubKey: lbPosition.publicKey,
          totalXAmount: new sdk.BN(params.amountX ?? 0),
          totalYAmount: new sdk.BN(params.amountY ?? 0),
          strategy: {
            minBinId: posData.lowerBinId,
            maxBinId: posData.upperBinId,
            strategyType,
          },
          user: userPubKey,
          slippage,
        });
      },
    );

    return {
      addedX: params.amountX ?? 0,
      addedY: params.amountY ?? 0,
      tx: signatures[signatures.length - 1],
    };
  }

  // --------------------------------------------------------------------------
  // Position queries
  // --------------------------------------------------------------------------

  /**
   * Get all positions for a wallet address.
   * Uses the static getAllLbPairPositionsByUser (no pool-specific instance needed).
   */
  async getPositions(walletAddress: string): Promise<Position[]> {
    const sdk = await getSDK();
    let allPositions: Map<string, PositionInfo>;

    try {
      allPositions = await sdk.dlmm.getAllLbPairPositionsByUser(
        this._readConnection,
        new PublicKey(walletAddress),
        { cluster: SDK_CLUSTER[this._options.cluster] },
      );
    } catch {
      return [];
    }

    if (allPositions.size === 0) return [];

    // Batch-resolve token symbols via registry (single RPC round-trip for unknowns)
    const registry = this._options.tokenRegistry;
    if (registry) {
      const mints = new Set<string>();
      for (const info of allPositions.values()) {
        mints.add(info.tokenX.mint.address.toBase58());
        mints.add(info.tokenY.mint.address.toBase58());
      }
      await registry.resolve([...mints]);
    }

    const results: Position[] = [];

    for (const [lbPairAddress, info] of allPositions) {
      const binStep: number = info.lbPair.binStep;
      const activeBinId: number = info.lbPair.activeId;
      const tokenXDecimals = info.tokenX.mint.decimals;
      const tokenYDecimals = info.tokenY.mint.decimals;
      const tokenXMint = info.tokenX.mint.address.toBase58();
      const tokenYMint = info.tokenY.mint.address.toBase58();

      const tokenXSymbol = (registry?.getCached(tokenXMint)?.symbol ?? tokenXMint.slice(0, 6)).toUpperCase();
      const tokenYSymbol = (registry?.getCached(tokenYMint)?.symbol ?? tokenYMint.slice(0, 6)).toUpperCase();
      const poolName = `${tokenXSymbol}-${tokenYSymbol}`;

      for (const lbPos of info.lbPairPositionsData) {
        const posData = lbPos.positionData;
        const lowerBin = posData.lowerBinId;
        const upperBin = posData.upperBinId;

        const status: Position['status'] =
          activeBinId >= lowerBin && activeBinId <= upperBin
            ? 'in_range'
            : activeBinId > upperBin
              ? 'out_of_range_above'
              : 'out_of_range_below';

        // SDK bin prices are raw — adjust for decimal difference to get human-readable Y-per-X price.
        const decimalAdj = 10 ** (tokenXDecimals - tokenYDecimals);
        const rangeLow = parseFloat(sdk.getPriceOfBinByBinId(lowerBin, binStep).toString()) * decimalAdj;
        const rangeHigh = parseFloat(sdk.getPriceOfBinByBinId(upperBin, binStep).toString()) * decimalAdj;
        const currentPrice = parseFloat(sdk.getPriceOfBinByBinId(activeBinId, binStep).toString()) * decimalAdj;
        const totalBins = upperBin - lowerBin + 1;

        const rawValueX = parseFloat(posData.totalXAmount);
        const rawValueY = parseFloat(posData.totalYAmount);
        const rawFeesX = posData.feeX.toNumber();
        const rawFeesY = posData.feeY.toNumber();

        results.push({
          address: lbPos.publicKey.toBase58(),
          pool: lbPairAddress,
          pool_name: poolName,
          status,
          token_x_mint: tokenXMint,
          token_y_mint: tokenYMint,
          token_x_decimals: tokenXDecimals,
          token_y_decimals: tokenYDecimals,
          current_value_x: rawValueX,
          current_value_y: rawValueY,
          current_value_x_ui: rawValueX / 10 ** tokenXDecimals,
          current_value_y_ui: rawValueY / 10 ** tokenYDecimals,
          fees_earned_x: rawFeesX,
          fees_earned_y: rawFeesY,
          fees_earned_x_ui: rawFeesX / 10 ** tokenXDecimals,
          fees_earned_y_ui: rawFeesY / 10 ** tokenYDecimals,
          range_low: rangeLow,
          range_high: rangeHigh,
          current_price: currentPrice,
          total_bins: totalBins,
          bin_step: binStep,
          deposited_x: 0,
          deposited_y: 0,
          pnl_usd: null,
          opened_at: posData.lastUpdatedAt.toNumber(),
        });
      }
    }

    return results;
  }

  /**
   * Get detailed info for a single position.
   */
  async getPositionDetail(position: string): Promise<Position> {
    const wallet = this._options.wallet;
    const positions = await this.getPositions(wallet.getPublicKey().toBase58());
    const found = positions.find((p) => p.address === position);
    if (!found) {
      throw new TransactionError(`Position ${position} not found`, 'POSITION_NOT_FOUND');
    }
    return found;
  }

  // --------------------------------------------------------------------------
  // Internal: find a position by address (scoped lookup when pool is cached)
  // --------------------------------------------------------------------------

  /**
   * Find a position by its address. Tries scoped lookup on cached pools first,
   * falls back to global search.
   */
  private async _findPosition(positionAddress: string): Promise<{
    positionInfo: PositionInfo;
    lbPosition: LbPosition;
  }> {
    const sdk = await getSDK();
    const userPubKey = this._options.wallet.getPublicKey();

    // Try scoped lookup on each cached pool first (much cheaper)
    for (const [poolAddr, instance] of this._poolCache) {
      try {
        const { userPositions } = await instance.getPositionsByUserAndLbPair(userPubKey);
        const match = userPositions.find(
          (p) => p.publicKey.toBase58() === positionAddress,
        );
        if (match) {
          // We need the PositionInfo shape — construct a minimal one from cache
          // But we need the full PositionInfo for the pool pubkey, so do a quick
          // global lookup only when we know the pool
          // Actually, we already know the pool address from the cache key
          // We need to return positionInfo with publicKey set to the pool
          // The global lookup gives us this naturally, so let's just use the match
          // and construct the info we need
          return {
            positionInfo: { publicKey: new PublicKey(poolAddr) } as PositionInfo,
            lbPosition: match,
          };
        }
      } catch {
        // Scoped lookup failed — continue to next pool or global search
      }
    }

    // Fall back to global search
    let allPositions: Map<string, PositionInfo>;
    try {
      allPositions = await sdk.dlmm.getAllLbPairPositionsByUser(
        this._readConnection,
        userPubKey,
        { cluster: SDK_CLUSTER[this._options.cluster] },
      );
    } catch (err: unknown) {
      throw new NetworkError(
        `Failed to fetch positions: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    for (const [, info] of allPositions) {
      const match = info.lbPairPositionsData.find(
        (p) => p.publicKey.toBase58() === positionAddress,
      );
      if (match) {
        // Cache this pool for future lookups
        const poolAddr = info.publicKey.toBase58();
        if (!this._poolCache.has(poolAddr)) {
          try {
            await this._getInstance(poolAddr);
          } catch {
            // Non-critical — caching failure shouldn't break the operation
          }
        }
        return { positionInfo: info, lbPosition: match };
      }
    }

    throw new TransactionError(
      `Position ${positionAddress} not found for this wallet`,
      'POSITION_NOT_FOUND',
    );
  }

  // Swap is handled by Jupiter Ultra API — see jup.ts / jupiterSwap()
}
