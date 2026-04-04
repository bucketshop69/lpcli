// ============================================================================
// DLMM Service (SDK Wrapper) — @lpcli/core
// ============================================================================

// SDK note: @meteora-ag/dlmm@1.9.4 ships a CJS bundle whose ESM entry
// eagerly imports @coral-xyz/anchor which lacks proper ESM named exports.
// ALL SDK imports MUST be lazy (dynamic import) to avoid top-level crashes
// when this module is loaded by tsx or Node ESM.
import type { LbPosition, PositionInfo } from '@meteora-ag/dlmm';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';

import type { OpenPositionResult, ClosePositionResult, Position } from './types.js';
import { NetworkError, TransactionError } from './errors.js';
import type { WalletService } from './wallet.js';

// BN type for compile-time use only — value resolved lazily via getSDK()
type BNType = { toNumber(): number; toString(): string };
type BNConstructor = new (value: number | string) => BNType;

// StrategyType enum values (mirrors SDK — Spot=0, Curve=1, BidAsk=2)
// We define our own to avoid eager SDK import.
const STRATEGY_TYPE = { Spot: 0, Curve: 1, BidAsk: 2 } as const;

// Lazy async loader — loads DLMM class, BN, and getPriceOfBinByBinId together.
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
  // Force CJS entry to avoid broken ESM directory imports in @meteora-ag/dlmm's index.mjs.
  // The SDK's ESM bundle references @coral-xyz/anchor/dist/cjs/utils/bytes (bare directory)
  // which Node 24 rejects with ERR_UNSUPPORTED_DIR_IMPORT.
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

// The instance type returned by DLMMClass.create — subset we actually use.
// SDK 1.9.4 breaking changes vs 1.5.4:
//   - removeLiquidity returns Promise<Transaction[]> (always array, not Transaction | Transaction[])
//   - claimSwapFee returns Promise<Transaction[]> (always array, not Transaction | null)
interface DLMMInstance {
  lbPair: {
    activeId: number;
    binStep: number;
  };
  tokenX: { mint: { address: PublicKey } };
  tokenY: { mint: { address: PublicKey } };
  getActiveBin(): Promise<{ binId: number; price: string }>;
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

export interface DLMMServiceOptions {
  rpcUrl: string;
  wallet: WalletService;
  cluster: 'mainnet' | 'devnet';
}

/**
 * Map our strategy string to the SDK StrategyType enum value.
 * SDK values: Spot=0, Curve=1, BidAsk=2
 */
export function toStrategyType(strategy: 'spot' | 'bidask' | 'curve'): number {
  switch (strategy) {
    case 'bidask': return STRATEGY_TYPE.BidAsk;
    case 'curve':  return STRATEGY_TYPE.Curve;
    case 'spot':
    default:       return STRATEGY_TYPE.Spot;
  }
}

/**
 * Sign a transaction with the wallet, then send it via the connection.
 * Wraps send errors in TransactionError; network errors in NetworkError.
 */
export async function signAndSend(
  tx: Transaction,
  wallet: WalletService,
  connection: Connection
): Promise<string> {
  let signed: Transaction;
  try {
    signed = await wallet.signTx(tx);
  } catch (err: unknown) {
    throw new TransactionError(
      `Failed to sign transaction: ${err instanceof Error ? err.message : String(err)}`,
      'SIGN_FAILURE',
      err
    );
  }
  try {
    return await connection.sendRawTransaction(signed.serialize());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Distinguish network-level failures from on-chain rejections
    if (msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('timeout')) {
      throw new NetworkError(`RPC send failed: ${msg}`, err);
    }
    throw new TransactionError(`Transaction failed: ${msg}`, 'SEND_FAILURE', err);
  }
}

export class DLMMService {
  constructor(private _options: DLMMServiceOptions) {}

  /**
   * Open a new liquidity position.
   *
   * Parameters:
   * - pool: pool address (base58 string)
   * - amountX / amountY: amounts in raw lamports
   * - strategy: 'spot' | 'bidask' | 'curve'   default: 'spot'
   * - widthBins: half-width in bins             default: max(10, floor(50/binStep))
   * - type: 'balanced' | 'imbalanced' | 'one_sided_x' | 'one_sided_y'
   *
   * SDK method: initializePositionAndAddLiquidityByStrategy
   *   — confirmed in dist/index.d.ts line 8103
   *
   * Returns: { position, range_low, range_high, deposited_x, deposited_y, tx }
   */
  async openPosition(params: {
    pool: string;
    amountX?: number;
    amountY?: number;
    strategy?: 'spot' | 'bidask' | 'curve';
    widthBins?: number;
    type?: 'balanced' | 'imbalanced' | 'one_sided_x' | 'one_sided_y';
  }): Promise<OpenPositionResult> {
    const sdk = await getSDK();
    const connection = new Connection(this._options.rpcUrl, 'confirmed');
    const wallet = this._options.wallet;
    const userPubKey = wallet.getPublicKey();

    let dlmm: DLMMInstance;
    try {
      dlmm = await sdk.dlmm.create(connection, new PublicKey(params.pool), {
        cluster: this._options.cluster,
      });
    } catch (err: unknown) {
      throw new NetworkError(`Failed to load pool ${params.pool}: ${err instanceof Error ? err.message : String(err)}`, err);
    }

    // Get current active bin to centre our range
    const activeBin = await dlmm.getActiveBin();
    const activeBinId = activeBin.binId;
    const binStep: number = dlmm.lbPair.binStep;

    // Default width: max(10, floor(50 / binStep))
    const halfWidth = params.widthBins ?? Math.max(10, Math.floor(50 / binStep));
    const minBinId = activeBinId - halfWidth;
    const maxBinId = activeBinId + halfWidth;

    const strategyType = toStrategyType(params.strategy ?? 'spot');

    // For one-sided positions, only supply one amount
    const amountX = new sdk.BN(params.amountX ?? 0);
    const amountY = new sdk.BN(params.amountY ?? 0);

    // Each position needs its own keypair — the position pubkey is the account being created
    const positionKeypair = Keypair.generate();

    const tx = await dlmm.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: positionKeypair.publicKey,
      totalXAmount: amountX,
      totalYAmount: amountY,
      strategy: { minBinId, maxBinId, strategyType },
      user: userPubKey,
      slippage: 1, // 1% default slippage
    });

    // The position keypair must also sign (it's the account being initialised)
    tx.partialSign(positionKeypair);

    const txSig = await signAndSend(tx, wallet, connection);

    // Derive range prices from bin IDs
    const rangeLow = parseFloat(sdk.getPriceOfBinByBinId(minBinId, binStep).toString());
    const rangeHigh = parseFloat(sdk.getPriceOfBinByBinId(maxBinId, binStep).toString());

    return {
      position: positionKeypair.publicKey.toBase58(),
      range_low: rangeLow,
      range_high: rangeHigh,
      deposited_x: params.amountX ?? 0,
      deposited_y: params.amountY ?? 0,
      tx: txSig,
    };
  }

  /**
   * Close a position (withdraw 100% liquidity + claim fees).
   *
   * Uses SDK removeLiquidity with shouldClaimAndClose=true.
   * SDK method: removeLiquidity — confirmed in dist/index.d.ts
   * bps: BN(10000) = 100%
   *
   * Returns: { withdrawn_x, withdrawn_y, claimed_fees_x, claimed_fees_y, tx }
   */
  async closePosition(positionAddress: string): Promise<ClosePositionResult> {
    const sdk = await getSDK();
    const connection = new Connection(this._options.rpcUrl, 'confirmed');
    const wallet = this._options.wallet;
    const userPubKey = wallet.getPublicKey();

    const positionPubKey = new PublicKey(positionAddress);

    // We need to find which pool this position belongs to.
    // getAllLbPairPositionsByUser returns a Map<lbPairAddress, PositionInfo>
    let positionInfo: PositionInfo | undefined;
    let lbPosition: LbPosition | undefined;

    let allPositions: Map<string, PositionInfo>;
    try {
      allPositions = await sdk.dlmm.getAllLbPairPositionsByUser(connection, userPubKey, {
        cluster: this._options.cluster,
      });
    } catch (err: unknown) {
      throw new NetworkError(`Failed to fetch positions: ${err instanceof Error ? err.message : String(err)}`, err);
    }

    for (const [, info] of allPositions) {
      const match = info.lbPairPositionsData.find(
        (p) => p.publicKey.toBase58() === positionAddress
      );
      if (match) {
        positionInfo = info;
        lbPosition = match;
        break;
      }
    }

    if (!positionInfo || !lbPosition) {
      throw new TransactionError(
        `Position ${positionAddress} not found for this wallet`,
        'POSITION_NOT_FOUND'
      );
    }

    const dlmm = await sdk.dlmm.create(connection, positionInfo.publicKey, {
      cluster: this._options.cluster,
    });

    const posData = lbPosition.positionData;

    // removeLiquidity with shouldClaimAndClose=true removes all liquidity + closes.
    // SDK 1.9.4: always returns Transaction[] (never a single Transaction)
    const txs = await dlmm.removeLiquidity({
      user: userPubKey,
      position: positionPubKey,
      fromBinId: posData.lowerBinId,
      toBinId: posData.upperBinId,
      bps: new sdk.BN(10_000), // 100%
      shouldClaimAndClose: true,
    });

    let lastSig = '';
    for (const tx of txs) {
      lastSig = await signAndSend(tx, wallet, connection);
    }

    return {
      withdrawn_x: parseFloat(posData.totalXAmount),
      withdrawn_y: parseFloat(posData.totalYAmount),
      claimed_fees_x: posData.feeX.toNumber(),
      claimed_fees_y: posData.feeY.toNumber(),
      tx: lastSig,
    };
  }

  /**
   * Get all positions for a wallet address.
   *
   * Uses DLMM.getAllLbPairPositionsByUser (static method).
   * Returns [] if wallet has no positions — never throws.
   *
   * SDK method: getAllLbPairPositionsByUser — confirmed in dist/index.d.ts
   * Return type: Map<string, PositionInfo>
   *   PositionInfo.lbPairPositionsData: LbPosition[]
   *   LbPosition.positionData: PositionData
   */
  async getPositions(walletAddress: string): Promise<Position[]> {
    const sdk = await getSDK();
    const connection = new Connection(this._options.rpcUrl, 'confirmed');
    let allPositions: Map<string, PositionInfo>;

    try {
      allPositions = await sdk.dlmm.getAllLbPairPositionsByUser(
        connection,
        new PublicKey(walletAddress),
        { cluster: this._options.cluster }
      );
    } catch {
      // Never throw — return empty on any failure
      return [];
    }

    if (allPositions.size === 0) return [];

    const results: Position[] = [];

    for (const [lbPairAddress, info] of allPositions) {
      const binStep: number = info.lbPair.binStep;

      // Determine active bin to compute status — use activeId from the lbPair state
      // lbPair.activeId is the current active bin
      const activeBinId: number = info.lbPair.activeId;

      for (const lbPos of info.lbPairPositionsData) {
        const posData = lbPos.positionData;

        const lowerBin = posData.lowerBinId;
        const upperBin = posData.upperBinId;

        const status: Position['status'] =
          activeBinId >= lowerBin && activeBinId <= upperBin
            ? 'in_range'
            : 'out_of_range';

        const rangeLow = parseFloat(sdk.getPriceOfBinByBinId(lowerBin, binStep).toString());
        const rangeHigh = parseFloat(sdk.getPriceOfBinByBinId(upperBin, binStep).toString());
        const currentPrice = parseFloat(sdk.getPriceOfBinByBinId(activeBinId, binStep).toString());

        // Token symbol from mint (fallback to truncated mint address)
        const tokenXSymbol = info.tokenX.mint.address.toBase58().slice(0, 4);
        const tokenYSymbol = info.tokenY.mint.address.toBase58().slice(0, 4);
        const poolName = `${tokenXSymbol}-${tokenYSymbol}`;

        results.push({
          address: lbPos.publicKey.toBase58(),
          pool: lbPairAddress,
          pool_name: poolName,
          status,
          deposited_x: 0, // SDK does not expose original deposit amounts — not tracked
          deposited_y: 0,
          current_value_x: parseFloat(posData.totalXAmount),
          current_value_y: parseFloat(posData.totalYAmount),
          pnl_usd: null, // Entry price not available from SDK — would need external storage
          fees_earned_x: posData.feeX.toNumber(),
          fees_earned_y: posData.feeY.toNumber(),
          range_low: rangeLow,
          range_high: rangeHigh,
          current_price: currentPrice,
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
    // Find it in getPositions — this is the simplest correct approach
    const wallet = this._options.wallet;
    const positions = await this.getPositions(wallet.getPublicKey().toBase58());
    const found = positions.find((p) => p.address === position);
    if (!found) {
      throw new TransactionError(`Position ${position} not found`, 'POSITION_NOT_FOUND');
    }
    return found;
  }

  /**
   * Claim swap fees from a position without removing liquidity.
   *
   * SDK method: claimSwapFee — confirmed in dist/index.d.ts
   * SDK 1.9.4: returns Promise<Transaction[]> (always array, never null).
   * Empty array means no fees to claim.
   */
  async claimFees(positionAddress: string): Promise<{ claimedX: number; claimedY: number; tx: string }> {
    const sdk = await getSDK();
    const connection = new Connection(this._options.rpcUrl, 'confirmed');
    const wallet = this._options.wallet;
    const userPubKey = wallet.getPublicKey();

    // Find the position across all pools
    let positionInfo: PositionInfo | undefined;
    let lbPosition: LbPosition | undefined;

    let allPositions: Map<string, PositionInfo>;
    try {
      allPositions = await sdk.dlmm.getAllLbPairPositionsByUser(connection, userPubKey, {
        cluster: this._options.cluster,
      });
    } catch (err: unknown) {
      throw new NetworkError(`Failed to fetch positions: ${err instanceof Error ? err.message : String(err)}`, err);
    }

    for (const [, info] of allPositions) {
      const match = info.lbPairPositionsData.find(
        (p) => p.publicKey.toBase58() === positionAddress
      );
      if (match) {
        positionInfo = info;
        lbPosition = match;
        break;
      }
    }

    if (!positionInfo || !lbPosition) {
      throw new TransactionError(
        `Position ${positionAddress} not found for this wallet`,
        'POSITION_NOT_FOUND'
      );
    }

    const dlmm = await sdk.dlmm.create(connection, positionInfo.publicKey, {
      cluster: this._options.cluster,
    });

    const claimedX = lbPosition.positionData.feeX.toNumber();
    const claimedY = lbPosition.positionData.feeY.toNumber();

    // SDK 1.9.4: claimSwapFee returns Transaction[] — empty array means no fees to claim
    const txs = await dlmm.claimSwapFee({
      owner: userPubKey,
      position: lbPosition,
    });

    if (txs.length === 0) {
      // No fees to claim
      return { claimedX: 0, claimedY: 0, tx: '' };
    }

    let lastSig = '';
    for (const tx of txs) {
      lastSig = await signAndSend(tx, wallet, connection);
    }

    return { claimedX, claimedY, tx: lastSig };
  }

  /**
   * Add liquidity to an existing position.
   *
   * Finds the position's pool, then calls addLiquidityByStrategy using the
   * position's existing bin range and the specified strategy.
   */
  async addLiquidity(params: {
    position: string;
    amountX?: number;
    amountY?: number;
    strategy?: 'spot' | 'bidask' | 'curve';
  }): Promise<{ addedX: number; addedY: number; tx: string }> {
    const sdk = await getSDK();
    const connection = new Connection(this._options.rpcUrl, 'confirmed');
    const wallet = this._options.wallet;
    const userPubKey = wallet.getPublicKey();

    // Find the position and its pool
    let positionInfo: PositionInfo | undefined;
    let lbPosition: LbPosition | undefined;

    let allPositions: Map<string, PositionInfo>;
    try {
      allPositions = await sdk.dlmm.getAllLbPairPositionsByUser(connection, userPubKey, {
        cluster: this._options.cluster,
      });
    } catch (err: unknown) {
      throw new NetworkError(`Failed to fetch positions: ${err instanceof Error ? err.message : String(err)}`, err);
    }

    for (const [, info] of allPositions) {
      const match = info.lbPairPositionsData.find(
        (p) => p.publicKey.toBase58() === params.position
      );
      if (match) {
        positionInfo = info;
        lbPosition = match;
        break;
      }
    }

    if (!positionInfo || !lbPosition) {
      throw new TransactionError(
        `Position ${params.position} not found for this wallet`,
        'POSITION_NOT_FOUND'
      );
    }

    const dlmm = await sdk.dlmm.create(connection, positionInfo.publicKey, {
      cluster: this._options.cluster,
    });

    const posData = lbPosition.positionData;
    const strategyType = toStrategyType(params.strategy ?? 'spot');

    const amountX = new sdk.BN(params.amountX ?? 0);
    const amountY = new sdk.BN(params.amountY ?? 0);

    const tx = await dlmm.addLiquidityByStrategy({
      positionPubKey: lbPosition.publicKey,
      totalXAmount: amountX,
      totalYAmount: amountY,
      strategy: {
        minBinId: posData.lowerBinId,
        maxBinId: posData.upperBinId,
        strategyType,
      },
      user: userPubKey,
      slippage: 1, // 1%
    });

    const txSig = await signAndSend(tx, wallet, connection);

    return {
      addedX: params.amountX ?? 0,
      addedY: params.amountY ?? 0,
      tx: txSig,
    };
  }

  // Swap is handled by Jupiter Ultra API — see jup.ts / jupiterSwap()
}
