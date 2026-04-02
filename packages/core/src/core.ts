/**
 * LPCLI Core — @lpcli/core
 *
 * All service code for LPCLI. This file will be split into separate modules
 * post-hackathon: client.ts, scoring.ts, dlmm.ts, positions.ts, wallet.ts, errors.ts, types.ts.
 *
 * TODO: Split into separate modules post-hackathon.
 */

// ============================================================================
// Types
// ============================================================================

export interface MeteoraPoolRaw {
  address: string;
  name: string;
  token_x: { mint: string; symbol: string; decimals: number };
  token_y: { mint: string; symbol: string; decimals: number };
  reserve_x: string;
  reserve_y: string;
  token_x_amount: number;
  token_y_amount: number;
  created_at: number;
  reward_mint_x: string;
  reward_mint_y: string;
  pool_config: {
    bin_step: number;
    activation_duration: number;
    min_price: number;
    max_price: number;
    fee_bps: number;
    protocol_fee_share_bps: number;
  };
  dynamic_fee_pct: number;
  tvl: number;
  current_price: number;
  apr: number;
  apy: number;
  has_farm: boolean;
  farm_apr: number;
  farm_apy: number;
  volume: Record<string, number>; // keys: "30m", "1h", "2h", "4h", "12h", "24h"
  fees: Record<string, number>; // keys: "30m", "1h", "2h", "4h", "12h", "24h"
  protocol_fees: Record<string, number>; // keys: "30m", "1h", "2h", "4h", "12h", "24h"
  fee_tvl_ratio: number | Record<string, number>; // raw number OR object with time-window keys
  cumulative_metrics: {
    total_volume: number;
    total_fees: number;
    total_liquidity_added: number;
    total_liquidity_removed: number;
  };
  is_blacklisted: boolean;
  launchpad: string | null;
  tags: string[];
}

export interface ScoredPool {
  address: string;
  name: string;
  token_x: string;
  token_y: string;
  bin_step: number;
  tvl: number;
  volume_24h: number;
  fee_tvl_ratio_24h: number;
  apr: number;
  score: number;
  momentum: number;
  has_farm: boolean;
  farm_apr: number;
}

export interface Position {
  address: string;
  pool: string;
  pool_name: string;
  status: 'in_range' | 'out_of_range' | 'closed';
  deposited_x: number;
  deposited_y: number;
  current_value_x: number;
  current_value_y: number;
  pnl_usd: number | null; // best-effort, null if entry price unavailable
  fees_earned_x: number;
  fees_earned_y: number;
  range_low: number;
  range_high: number;
  current_price: number;
  opened_at: number;
}

export interface PoolInfo {
  address: string;
  name: string;
  token_x: string;
  token_y: string;
  bin_step: number;
  active_bin: number;
  current_price: number;
  tvl: number;
  volume_24h: number;
  fee_24h: number;
  apr: number;
  apy: number;
  has_farm: boolean;
  farm_apr: number;
}

export interface OpenPositionResult {
  position: string;
  range_low: number;
  range_high: number;
  deposited_x: number;
  deposited_y: number;
  tx: string;
}

export interface ClosePositionResult {
  withdrawn_x: number;
  withdrawn_y: number;
  claimed_fees_x: number;
  claimed_fees_y: number;
  tx: string;
}

// ============================================================================
// Error Classes
// ============================================================================

export class NetworkError extends Error {
  retryable = true;
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class TransactionError extends Error {
  retryable = false;
  constructor(
    message: string,
    public code: string,
    public raw?: unknown
  ) {
    super(message);
    this.name = 'TransactionError';
  }
}

// ============================================================================
// Scoring Engine
// ============================================================================

const TVL_GATE = 10_000; // $10K minimum TVL to be considered

export interface ScoringWeights {
  feeYield: number;
  volumeRatio: number;
  tvl: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  feeYield: 0.4,
  volumeRatio: 0.3,
  tvl: 0.3,
};

/**
 * Momentum: volume_1h vs volume_24h/24 baseline.
 * A ratio < 0.5 means the pool is cooling off → apply 20% score penalty.
 * A ratio > 2.0 is capped at 2.0 to prevent a single whale trade dominating.
 *
 * WARNING: This is a heuristic, not proven predictive.
 * TODO: Backtest this metric against actual pool performance.
 */
function computeMomentum(pool: MeteoraPoolRaw): number {
  const h24 = pool.volume["24h"] ?? 0;
  const h1 = pool.volume["1h"] ?? 0;
  const baseline = h24 / 24;
  if (baseline === 0) return 1.0;
  const ratio = h1 / baseline;
  if (ratio < 0.5) return 0.8; // 20% penalty
  return Math.min(ratio, 2.0);
}

function scorePool(pool: MeteoraPoolRaw, weights: ScoringWeights = DEFAULT_WEIGHTS): number {
  // Gate: skip blacklisted and thin liquidity pools
  if (pool.is_blacklisted) return -1;
  if (pool.tvl < TVL_GATE) return -1;

  const feeYield = getFeeYield(pool.fee_tvl_ratio);
  const volumeRatio = getVolume24(pool.volume) / pool.tvl;
  const tvlScore = Math.log10(pool.tvl + 1) / 15; // normalized to ~0-1 for $10M TVL
  const momentum = computeMomentum(pool);

  return (weights.feeYield * feeYield * 100 + weights.volumeRatio * volumeRatio * 100 + weights.tvl * tvlScore * 100) * momentum;
}

export function rankPools(pools: MeteoraPoolRaw[], weights: ScoringWeights = DEFAULT_WEIGHTS): ScoredPool[] {
  return pools
    .map((p) => ({
      address: p.address,
      name: p.name,
      token_x: p.token_x.symbol,
      token_y: p.token_y.symbol,
      bin_step: p.pool_config.bin_step,
      tvl: p.tvl,
      volume_24h: getVolume24(p.volume),
      fee_tvl_ratio_24h: getFeeYield(p.fee_tvl_ratio),
      apr: p.apr,
      score: scorePool(p, weights),
      momentum: computeMomentum(p),
      has_farm: p.has_farm,
      farm_apr: p.farm_apr,
    }))
    .filter((p) => p.score >= 0)
    .sort((a, b) => b.score - a.score);
}

// ============================================================================
// Meteora REST Client
// ============================================================================

export interface MeteoraClientOptions {
  rpcUrl: string;
  cluster: 'mainnet' | 'devnet';
}

const METEORA_BASE = {
  mainnet: 'https://dlmm.datapi.meteora.ag',
  devnet: 'https://dlmm-api.devnet.meteora.ag',
};

export class MeteoraClient {
  private cache: Map<string, { data: unknown; expiry: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(private options: MeteoraClientOptions) {}

  private baseUrl(): string {
    return METEORA_BASE[this.options.cluster];
  }

  private async fetch<T>(path: string, useCache = true): Promise<T> {
    const cacheKey = path;
    const cached = this.cache.get(cacheKey);

    if (useCache && cached && cached.expiry > Date.now()) {
      return cached.data as T;
    }

    const url = `${this.baseUrl()}${path}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new NetworkError(`Meteora API error: ${response.status} ${response.statusText} — ${url}`);
    }

    const data = (await response.json()) as T;

    if (useCache) {
      this.cache.set(cacheKey, { data, expiry: Date.now() + this.CACHE_TTL });
    }

    return data;
  }

  /**
   * Fetch all pools from Meteora REST API.
   * Response shape confirmed from: https://dlmm.datapi.meteora.ag/pair/all
   */
  async getPools(params?: {
    page?: number;
    pageSize?: number;
    query?: string;
    sortBy?: string;
    filterBy?: string;
  }): Promise<{ total: number; pages: number; data: MeteoraPoolRaw[] }> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('page_size', String(params.pageSize));
    if (params?.query) qs.set('query', params.query);
    if (params?.sortBy) qs.set('sort_by', params.sortBy);
    if (params?.filterBy) qs.set('filter_by', params.filterBy);

    const path = `/pools${qs.size > 0 ? `?${qs.toString()}` : ''}`;
    return this.fetch(path);
  }

  /**
   * Fetch a single pool by address.
   */
  async getPool(address: string): Promise<MeteoraPoolRaw> {
    return this.fetch(`/pools/${address}`);
  }

  /**
   * Invalidate the cache (force fresh fetch).
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// ============================================================================
// Wallet Service
// ============================================================================

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';

export interface WalletOptions {
  rpcUrl: string;
  privateKey?: string;   // base58 encoded or file path
  owsWalletName?: string; // OWS wallet name (takes priority over privateKey)
}

// Internal signer interface — allows OWS or keypair backends behind the same surface
interface WalletBackend {
  publicKey: PublicKey;
  signTransaction(tx: Transaction): Promise<Transaction>;
}

// OWS backend — wraps @open-wallet-standard/core when installed
class OWSBackend implements WalletBackend {
  publicKey: PublicKey;
  private walletName: string;

  constructor(walletName: string, publicKey: PublicKey) {
    this.walletName = walletName;
    this.publicKey = publicKey;
  }

  async signTransaction(tx: Transaction): Promise<Transaction> {
    // Use a runtime-only import so TypeScript does not attempt to resolve the
    // optional peer dependency at compile time.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const dynamicImport = new Function('specifier', 'return import(specifier)');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ows = await dynamicImport('@open-wallet-standard/core') as any;
    const txHex = tx.serialize({ requireAllSignatures: false }).toString('hex');
    const signedHex: string = await ows.signTransaction(this.walletName, 'solana', txHex);
    const signedBuf = Buffer.from(signedHex, 'hex');
    return Transaction.from(signedBuf);
  }
}

// Keypair backend — raw Solana Keypair (file or base58)
class KeypairBackend implements WalletBackend {
  publicKey: PublicKey;
  private keypair: Keypair;

  constructor(keypair: Keypair) {
    this.keypair = keypair;
    this.publicKey = keypair.publicKey;
  }

  async signTransaction(tx: Transaction): Promise<Transaction> {
    tx.partialSign(this.keypair);
    return tx;
  }
}

/**
 * Load a keypair from a JSON file (array of numbers — standard Solana format).
 * Expands leading ~ to the home directory.
 */
function loadKeypairFromFile(filePath: string): Keypair {
  const resolved = filePath.startsWith('~')
    ? filePath.replace('~', homedir())
    : filePath;
  const json = JSON.parse(readFileSync(resolved, 'utf-8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(json));
}

/**
 * Decode a base58-encoded Solana private key string into a Keypair.
 *
 * Solana's "private key" in base58 is the full 64-byte secret key
 * (32-byte seed + 32-byte public key). We use a minimal base58 decoder
 * so we avoid a hard dependency on the bs58 package at runtime.
 */
function keypairFromBase58(encoded: string): Keypair {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const alphabetMap: Record<string, number> = {};
  for (let i = 0; i < ALPHABET.length; i++) alphabetMap[ALPHABET[i]] = i;

  let decoded = BigInt(0);
  for (const char of encoded) {
    const digit = alphabetMap[char];
    if (digit === undefined) throw new Error(`Invalid base58 character: ${char}`);
    decoded = decoded * BigInt(58) + BigInt(digit);
  }

  // Convert BigInt to a fixed 64-byte array
  const bytes = new Uint8Array(64);
  let remaining = decoded;
  for (let i = 63; i >= 0; i--) {
    bytes[i] = Number(remaining & BigInt(0xff));
    remaining >>= BigInt(8);
  }

  return Keypair.fromSecretKey(bytes);
}

export class WalletService {
  private backend: WalletBackend;
  private connection: Connection;

  private constructor(backend: WalletBackend, connection: Connection) {
    this.backend = backend;
    this.connection = connection;
  }

  /**
   * Initialise WalletService using the best available backend.
   *
   * Detection order:
   *  1. OWS — if OWS_WALLET_NAME env var is set and @open-wallet-standard/core is installed
   *  2. Keypair file — if PRIVATE_KEY starts with ~ or /
   *  3. Keypair base58 — if PRIVATE_KEY is a base58 string
   *  4. Error — nothing configured
   *
   * The options.privateKey param (from LPCLIOptions) is used as a fallback
   * when PRIVATE_KEY is not set in the environment.
   */
  static async init(options: WalletOptions): Promise<WalletService> {
    const connection = new Connection(options.rpcUrl, 'confirmed');

    // ── 1. OWS backend ──────────────────────────────────────────────────────
    const owsWalletName = options.owsWalletName ?? process.env['OWS_WALLET_NAME'];
    if (owsWalletName) {
      try {
        // Runtime-only import to avoid compile-time resolution of optional peer dep.
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const dynamicImport = new Function('specifier', 'return import(specifier)');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ows = await dynamicImport('@open-wallet-standard/core') as any;
        const wallets: unknown[] = await ows.listWallets();
        const wallet = wallets.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (w: any) => w.name === owsWalletName
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ) as any;
        if (!wallet) {
          throw new Error(`OWS wallet "${owsWalletName}" not found. Run: ows wallet create --name ${owsWalletName}`);
        }
        // OWS wallet has accounts[] per chain — find the Solana one
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const solanaAccount = (wallet.accounts as any[]).find(
          (a: any) => typeof a.chainId === 'string' && a.chainId.startsWith('solana:')
        );
        if (!solanaAccount) {
          throw new Error(`OWS wallet "${owsWalletName}" has no Solana account.`);
        }
        const pubkey = new PublicKey(solanaAccount.address as string);
        const backend = new OWSBackend(owsWalletName, pubkey);
        return new WalletService(backend, connection);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        // If OWS is simply not installed, fall through to keypair backends
        if (message.includes('Cannot find') || message.includes('ERR_MODULE_NOT_FOUND') || message.includes('MODULE_NOT_FOUND')) {
          // OWS package not installed — silently fall through
        } else {
          // OWS is installed but configuration failed — propagate
          throw err;
        }
      }
    }

    // ── 2 & 3. Keypair backends ──────────────────────────────────────────────
    const privateKeyEnv = process.env['PRIVATE_KEY'] ?? options.privateKey;
    if (privateKeyEnv) {
      if (privateKeyEnv.startsWith('~') || privateKeyEnv.startsWith('/')) {
        // File path backend
        const keypair = loadKeypairFromFile(privateKeyEnv);
        return new WalletService(new KeypairBackend(keypair), connection);
      } else {
        // base58 string backend
        const keypair = keypairFromBase58(privateKeyEnv);
        return new WalletService(new KeypairBackend(keypair), connection);
      }
    }

    // ── 4. Nothing configured ────────────────────────────────────────────────
    throw new Error(
      'No wallet configured. Run `lpcli init` to set up.'
    );
  }

  /** Return the wallet's Solana public key. */
  getPublicKey(): PublicKey {
    return this.backend.publicKey;
  }

  /** Return the SOL balance in lamports via RPC. */
  async getBalance(): Promise<number> {
    return this.connection.getBalance(this.backend.publicKey);
  }

  /**
   * Sign a transaction using whichever backend is active.
   * Does NOT broadcast — the caller is responsible for sending.
   */
  async signTx(tx: Transaction): Promise<Transaction> {
    return this.backend.signTransaction(tx);
  }

  /**
   * Estimate the priority fee for a transaction via Helius.
   * Falls back to 0 on any failure (network, auth, parse, etc.).
   *
   * @param txBase64 - base64-encoded serialised transaction
   * @param level - Helius priority level (default: "Medium")
   */
  async getPriorityFee(
    txBase64: string,
    level: 'Min' | 'Low' | 'Medium' | 'High' | 'VeryHigh' | 'UnsafeMax' = 'Medium'
  ): Promise<number> {
    try {
      const response = await fetch(this.connection.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getPriorityFeeEstimate',
          params: [
            {
              transaction: txBase64,
              options: { priorityLevel: level },
            },
          ],
        }),
      });

      if (!response.ok) return 0;

      const json = (await response.json()) as {
        result?: { priorityFeeEstimate?: number };
        error?: unknown;
      };

      if (json.error || json.result?.priorityFeeEstimate === undefined) return 0;
      return json.result.priorityFeeEstimate;
    } catch {
      return 0;
    }
  }
}

// ============================================================================
// DLMM Service (SDK Wrapper)
// ============================================================================

// SDK note: @meteora-ag/dlmm@1.5.4 ships a CJS bundle with no `exports` field.
// Under NodeNext + esModuleInterop, `import default` is typed as the module
// namespace, hiding the class methods. We import the namespace and re-bind
// via `any` to recover the class type, then explicitly annotate with the
// interface we need to call the static methods.
import type { LbPosition, PositionInfo } from '@meteora-ag/dlmm';
import { StrategyType, getPriceOfBinByBinId } from '@meteora-ag/dlmm';
import anchorPkg from '@coral-xyz/anchor';
import type { BN as BNType } from '@coral-xyz/anchor';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BN = (anchorPkg as any).BN as new (value: number | string) => BNType;

// Lazy async loader for the CJS DLMM SDK — avoids require() in ESM context.
type DLMMClassType = {
  create(connection: Connection, pool: PublicKey, opt?: { cluster?: string }): Promise<DLMMInstance>;
  getAllLbPairPositionsByUser(
    connection: Connection,
    userPubKey: PublicKey,
    opt?: { cluster?: string }
  ): Promise<Map<string, PositionInfo>>;
};
let _dlmmClass: DLMMClassType | null = null;
async function getDLMM(): Promise<DLMMClassType> {
  if (_dlmmClass) return _dlmmClass;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (await import('@meteora-ag/dlmm')) as any;
  _dlmmClass = (m.default ?? m) as DLMMClassType;
  return _dlmmClass;
}

// The instance type returned by DLMMClass.create — subset we actually use.
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
    strategy: { minBinId: number; maxBinId: number; strategyType: StrategyType };
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
  }): Promise<Transaction | Transaction[]>;
  claimSwapFee(params: {
    owner: PublicKey;
    position: LbPosition;
  }): Promise<Transaction | null>;
}

export interface DLMMServiceOptions {
  rpcUrl: string;
  wallet: WalletService;
  cluster: 'mainnet' | 'devnet';
}

/**
 * Map our strategy string to the SDK StrategyType enum.
 * SDK values confirmed from dist/index.d.ts:
 *   StrategyType.Spot = 0, StrategyType.Curve = 1, StrategyType.BidAsk = 2
 */
function toStrategyType(strategy: 'spot' | 'bidask' | 'curve'): StrategyType {
  switch (strategy) {
    case 'bidask': return StrategyType.BidAsk;
    case 'curve':  return StrategyType.Curve;
    case 'spot':
    default:       return StrategyType.Spot;
  }
}

/**
 * Sign a transaction with the wallet, then send it via the connection.
 * Wraps send errors in TransactionError; network errors in NetworkError.
 */
async function signAndSend(
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
    const connection = new Connection(this._options.rpcUrl, 'confirmed');
    const wallet = this._options.wallet;
    const userPubKey = wallet.getPublicKey();

    let dlmm: DLMMInstance;
    try {
      dlmm = await (await getDLMM()).create(connection, new PublicKey(params.pool), {
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
    const amountX = new BN(params.amountX ?? 0);
    const amountY = new BN(params.amountY ?? 0);

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
    const rangeLow = parseFloat(getPriceOfBinByBinId(minBinId, binStep).toString());
    const rangeHigh = parseFloat(getPriceOfBinByBinId(maxBinId, binStep).toString());

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
   * SDK method: removeLiquidity — confirmed in dist/index.d.ts line 8157
   * bps: BN(10000) = 100%
   *
   * Returns: { withdrawn_x, withdrawn_y, claimed_fees_x, claimed_fees_y, tx }
   */
  async closePosition(positionAddress: string): Promise<ClosePositionResult> {
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
      allPositions = await (await getDLMM()).getAllLbPairPositionsByUser(connection, userPubKey, {
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

    const dlmm = await (await getDLMM()).create(connection, positionInfo.publicKey, {
      cluster: this._options.cluster,
    });

    const posData = lbPosition.positionData;

    // removeLiquidity with shouldClaimAndClose=true removes all liquidity + closes
    const txOrTxs = await dlmm.removeLiquidity({
      user: userPubKey,
      position: positionPubKey,
      fromBinId: posData.lowerBinId,
      toBinId: posData.upperBinId,
      bps: new BN(10_000), // 100%
      shouldClaimAndClose: true,
    });

    // SDK may return a single Transaction or an array
    const txs = Array.isArray(txOrTxs) ? txOrTxs : [txOrTxs];
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
   * SDK method: getAllLbPairPositionsByUser — confirmed in dist/index.d.ts line 8842
   * Return type: Map<string, PositionInfo>
   *   PositionInfo.lbPairPositionsData: LbPosition[]
   *   LbPosition.positionData: PositionData
   */
  async getPositions(walletAddress: string): Promise<Position[]> {
    const connection = new Connection(this._options.rpcUrl, 'confirmed');
    let allPositions: Map<string, PositionInfo>;

    try {
      allPositions = await (await getDLMM()).getAllLbPairPositionsByUser(
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

        const rangeLow = parseFloat(getPriceOfBinByBinId(lowerBin, binStep).toString());
        const rangeHigh = parseFloat(getPriceOfBinByBinId(upperBin, binStep).toString());
        const currentPrice = parseFloat(getPriceOfBinByBinId(activeBinId, binStep).toString());

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
   * SDK method: claimSwapFee — confirmed in dist/index.d.ts line 8281
   * Returns Transaction | null — null means no fees to claim.
   */
  async claimFees(positionAddress: string): Promise<{ claimedX: number; claimedY: number; tx: string }> {
    const connection = new Connection(this._options.rpcUrl, 'confirmed');
    const wallet = this._options.wallet;
    const userPubKey = wallet.getPublicKey();

    // Find the position across all pools
    let positionInfo: PositionInfo | undefined;
    let lbPosition: LbPosition | undefined;

    let allPositions: Map<string, PositionInfo>;
    try {
      allPositions = await (await getDLMM()).getAllLbPairPositionsByUser(connection, userPubKey, {
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

    const dlmm = await (await getDLMM()).create(connection, positionInfo.publicKey, {
      cluster: this._options.cluster,
    });

    const claimedX = lbPosition.positionData.feeX.toNumber();
    const claimedY = lbPosition.positionData.feeY.toNumber();

    const tx = await dlmm.claimSwapFee({
      owner: userPubKey,
      position: lbPosition,
    });

    if (!tx) {
      // null means no fees to claim
      return { claimedX: 0, claimedY: 0, tx: '' };
    }

    const txSig = await signAndSend(tx, wallet, connection);
    return { claimedX, claimedY, tx: txSig };
  }

  /**
   * Add liquidity to an existing position.
   * SDK method: addLiquidityByStrategy
   */
  async addLiquidity(params: {
    position: string;
    amountX?: number;
    amountY?: number;
  }): Promise<{ addedX: number; addedY: number; tx: string }> {
    // TODO: resolve pool address for the position, then call addLiquidityByStrategy
    void params;
    throw new Error('TODO: implement addLiquidity');
  }

  /**
   * Swap tokens within a pool.
   * SDK method: swap (see dist/index.d.ts line 8247)
   */
  async swap(params: {
    pool: string;
    amountIn: number;
    tokenIn: 'x' | 'y';
    slippageBps?: number;
  }): Promise<{ amountOut: number; priceImpact: number; tx: string }> {
    // TODO: implement using dlmm.swapQuote then dlmm.swap
    void params;
    throw new Error('TODO: implement swap');
  }
}

// ============================================================================
// LPCLI Main Class
// ============================================================================

export interface LPCLIOptions {
  rpcUrl: string;
  cluster: 'mainnet' | 'devnet';
  privateKey?: string;
}

export class LPCLI {
  public meteora: MeteoraClient;
  /** Lazily initialised — call `getWallet()` to trigger init. */
  private _wallet: WalletService | undefined;
  public dlmm: DLMMService | undefined;
  private _options: LPCLIOptions;

  constructor(options: LPCLIOptions) {
    this._options = options;
    this.meteora = new MeteoraClient({ rpcUrl: options.rpcUrl, cluster: options.cluster });
  }

  /**
   * Initialise (or return the cached) WalletService.
   * Throws if no wallet is configured.
   */
  async getWallet(): Promise<WalletService> {
    if (!this._wallet) {
      this._wallet = await WalletService.init({
        rpcUrl: this._options.rpcUrl,
        privateKey: this._options.privateKey,
      });
      this.dlmm = new DLMMService({
        rpcUrl: this._options.rpcUrl,
        wallet: this._wallet,
        cluster: this._options.cluster,
      });
    }
    return this._wallet;
  }

  /**
   * @deprecated Use `getWallet()` — wallet init is now async.
   * This accessor throws if the wallet has not yet been initialised.
   */
  get wallet(): WalletService {
    if (!this._wallet) {
      throw new Error(
        'Wallet not yet initialised. Call `await lpcli.getWallet()` first.'
      );
    }
    return this._wallet;
  }

  /**
   * Discover and rank DLMM pools for a given token pair.
   *
   * @param token - Token symbol to search for (e.g., "SOL", "BTC")
   * @param sortBy - Sort key: "score" | "fee_yield" | "volume" | "tvl"
   * @param limit - Max number of pools to return
   */
  async discoverPools(
    token?: string,
    sortBy: 'score' | 'fee_yield' | 'volume' | 'tvl' = 'score',
    limit = 10
  ): Promise<ScoredPool[]> {
    const sortMap: Record<string, string> = {
      score: undefined as unknown as string, // we sort post-fetch
      fee_yield: 'fee_24h:desc',
      volume: 'volume_24h:desc',
      tvl: 'tvl:desc',
    };

    const filter = 'is_blacklisted=false'; // gate: exclude blacklisted pools

    const result = await this.meteora.getPools({
      query: token,
      pageSize: 100, // fetch enough to get good pool set
      sortBy: sortMap[sortBy],
      filterBy: filter,
    });

    const ranked = rankPools(result.data);

    if (sortBy === 'score') {
      return ranked.slice(0, limit);
    }

    // For other sort keys, re-sort after scoring (fe_tvl_ratio already applied)
    const sorted =
      sortBy === 'fee_yield'
        ? [...ranked].sort((a, b) => b.fee_tvl_ratio_24h - a.fee_tvl_ratio_24h)
        : sortBy === 'volume'
          ? [...ranked].sort((a, b) => b.volume_24h - a.volume_24h)
          : [...ranked].sort((a, b) => b.tvl - a.tvl);

    return sorted.slice(0, limit);
  }

  /**
   * Get detailed info for a specific pool.
   */
  async getPoolInfo(address: string): Promise<PoolInfo> {
    const raw = await this.meteora.getPool(address);
    return {
      address: raw.address,
      name: raw.name,
      token_x: raw.token_x.symbol,
      token_y: raw.token_y.symbol,
      bin_step: raw.pool_config.bin_step,
      active_bin: 0, // TODO: get from SDK or derive from current_price
      current_price: raw.current_price,
      tvl: raw.tvl,
      volume_24h: getVolume24(raw.volume),
      fee_24h: getFees24(raw.fees),
      apr: raw.apr,
      apy: raw.apy,
      has_farm: raw.has_farm,
      farm_apr: raw.farm_apr,
    };
  }
}

// ============================================================================
// Class exports — inline (do not add duplicate export {} statements below)
// ============================================================================
// All public classes are exported directly above their declaration.
// Re-exported via packages/core/index.ts for the package boundary.

// ============================================================================
// Helpers
// ============================================================================

function getFeeYield(feeTvlRatio: number | Record<string, number>): number {
  if (typeof feeTvlRatio === 'number') return feeTvlRatio;
  return feeTvlRatio['24h'] ?? feeTvlRatio['1h'] ?? 0;
}

function getVolume24(volume: Record<string, number>): number {
  return volume['24h'] ?? 0;
}

function getFees24(fees: Record<string, number>): number {
  return fees['24h'] ?? 0;
}
