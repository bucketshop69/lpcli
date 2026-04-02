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

export interface WalletOptions {
  rpcUrl: string;
  privateKey?: string; // base58 encoded or file path
}

export class WalletService {
  // TODO: Implement keypair loading
  // - If privateKey looks like a file path (starts with ~ or /), read the file
  // - If it's base58, decode to Keypair
  // - If undefined, check env.WALLET_PRIVATE_KEY

  // TODO: Implement Helius priority fee estimation
  // POST to ${rpcUrl} with method "getPriorityFeeEstimate"
  // Serialize the transaction, get back { priorityFeeEstimate: number }
  // Use 'Medium' level for normal ops, 'High' for time-sensitive rebalances

  // TODO: Implement OWSSigner adapter (post-hackathon)
  // The OWS (@open-wallet-standard/core) integration is a future enhancement.
  // For hackathon, we use Keypair directly.

  constructor(options: WalletOptions) {
    // Placeholder: actual implementation below
    void options;
  }

  async getBalance(): Promise<number> {
    // TODO: Connect to RPC, fetch balance for the loaded keypair
    return 0;
  }

  async getPriorityFee(_txBase64: string): Promise<number> {
    // TODO: Call Helius getPriorityFeeEstimate
    // Default to 'Medium' if not specified
    return 0;
  }
}

// ============================================================================
// DLMM Service (SDK Wrapper)
// ============================================================================

export interface DLMMServiceOptions {
  rpcUrl: string;
  wallet: WalletService;
  cluster: 'mainnet' | 'devnet';
}

export class DLMMService {
  // TODO: Initialize DLMM SDK client with connection + wallet Keypair

  constructor(private options: DLMMServiceOptions) {}

  /**
   * Open a new liquidity position.
   *
   * Parameters:
   * - pool: pool address
   * - amountX / amountY: amounts to deposit (BN or number in lamports)
   * - strategy: 'spot' | 'bidask' | 'curve'
   * - widthBins: number of bins on each side of active bin
   *   Default: max(10, floor(50 / binStep)) bins — ~50bps price coverage
   * - type: 'balanced' | 'imbalanced' | 'one_sided_x' | 'one_sided_y'
   *
   * Returns: { position, rangeLow, rangeHigh, depositedX, depositedY, tx }
   */
  async openPosition(params: {
    pool: string;
    amountX?: number;
    amountY?: number;
    strategy?: 'spot' | 'bidask' | 'curve';
    widthBins?: number;
    type?: 'balanced' | 'imbalanced' | 'one_sided_x' | 'one_sided_y';
  }): Promise<OpenPositionResult> {
    // TODO: Implement using @meteora-ag/dlmm SDK
    // Key questions to answer from SDK source:
    // - What method for opening a position? (likely depositLiquidityByStrategy)
    // - What StrategyType enum values? (Spot, BidAsk, Curve)
    // - Does the method return a Transaction or send it directly?
    // - What are the required signers?
    void params;
    throw new Error('TODO: implement openPosition');
  }

  /**
   * Close a position (withdraw 100% + claim fees in one flow).
   *
   * Two steps under the hood: removeLiquidity + claimFees.
   * May be combined into a single transaction by the SDK.
   *
   * Returns: { withdrawnX, withdrawnY, claimedFeesX, claimedFeesY, tx }
   */
  async closePosition(position: string): Promise<ClosePositionResult> {
    // TODO: Implement using @meteora-ag/dlmm SDK
    // likely: removeLiquidity(position, 10000 bps) + claimFee(position)
    void position;
    throw new Error('TODO: implement closePosition');
  }

  /**
   * Get all positions for a wallet.
   *
   * Returns positions with:
   * - Basic info (address, pool, amounts)
   * - Status: in_range / out_of_range / closed
   * - P&L (best-effort — may be null if entry price not accessible via SDK)
   * - Fees earned
   */
  async getPositions(walletAddress: string): Promise<Position[]> {
    // TODO: Implement using @meteora-ag/dlmm SDK
    // Key: find getUserPositions or similar method
    // Check if SDK exposes entry price for P&L calculation
    // If not, pnl_usd should be null for positions not opened via LPCLI
    void walletAddress;
    throw new Error('TODO: implement getPositions');
  }

  /**
   * Get detailed info for a single position.
   */
  async getPositionDetail(position: string): Promise<Position> {
    // TODO: Implement — deep dive with bin distribution, entry price, IL estimate
    void position;
    throw new Error('TODO: implement getPositionDetail');
  }

  /**
   * Claim fees from a position without closing it.
   */
  async claimFees(position: string): Promise<{ claimedX: number; claimedY: number; tx: string }> {
    // TODO: Implement using SDK claimFee / claimReward method
    void position;
    throw new Error('TODO: implement claimFees');
  }

  /**
   * Add liquidity to an existing position.
   */
  async addLiquidity(params: {
    position: string;
    amountX?: number;
    amountY?: number;
  }): Promise<{ addedX: number; addedY: number; tx: string }> {
    // TODO: Implement using SDK addLiquidity method
    void params;
    throw new Error('TODO: implement addLiquidity');
  }

  /**
   * Swap tokens within a pool.
   */
  async swap(params: {
    pool: string;
    amountIn: number;
    tokenIn: 'x' | 'y';
    slippageBps?: number;
  }): Promise<{ amountOut: number; priceImpact: number; tx: string }> {
    // TODO: Implement using SDK swap method
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
  public wallet: WalletService;
  public dlmm: DLMMService;

  constructor(options: LPCLIOptions) {
    this.meteora = new MeteoraClient({ rpcUrl: options.rpcUrl, cluster: options.cluster });
    this.wallet = new WalletService({ rpcUrl: options.rpcUrl, privateKey: options.privateKey });
    this.dlmm = new DLMMService({ rpcUrl: options.rpcUrl, wallet: this.wallet, cluster: options.cluster });
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
