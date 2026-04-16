// ============================================================================
// Meteora REST Client — @lpcli/core
//
// Uses pool-discovery API for rich pool data (advanced metrics, token info).
// All responses are structured for both CLI display and agent consumption.
// ============================================================================

import type { MeteoraPoolRaw, DiscoveredPool, DiscoverConfig, MeteoraClientOptions } from './types.js';
import { NetworkError } from './errors.js';
import { TokenRegistry } from './tokens.js';

// ============================================================================
// API base URLs
// ============================================================================

const DISCOVERY_API_BASE = {
  mainnet: 'https://pool-discovery-api.datapi.meteora.ag',
  devnet: 'https://pool-discovery-api.datapi.meteora.ag', // same for now
};

// ============================================================================
// Default discover config
// ============================================================================

export const DEFAULT_DISCOVER_CONFIG: DiscoverConfig = {
  pageSize: 10,
  defaultSort: 'fee_active_tvl_ratio',
  minActiveTvl: 50_000,
  minSwapCount: 200,
  minTraders: 50,
};

// ============================================================================
// Client
// ============================================================================

export class MeteoraClient {
  private cache: Map<string, { data: unknown; expiry: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  /** Optional token registry — when set, API responses auto-populate it. */
  private _tokenRegistry: TokenRegistry | undefined;

  constructor(private options: MeteoraClientOptions) {}

  /** Attach a token registry for auto-population from API responses. */
  setTokenRegistry(registry: TokenRegistry): void {
    this._tokenRegistry = registry;
  }

  private baseUrl(): string {
    return DISCOVERY_API_BASE[this.options.cluster];
  }

  // --------------------------------------------------------------------------
  // Raw HTTP
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // Pool listing (raw)
  // --------------------------------------------------------------------------

  /**
   * Fetch pools from pool-discovery API.
   *
   * @param query   Token symbol, pair name, token mint, or pool address.
   * @param sortBy  Sort field + direction, e.g. 'fee_active_tvl_ratio:desc'.
   * @param pageSize Number of results (max 100).
   * @param filterBy Exact-match filters, e.g. 'is_blacklisted=false'.
   */
  async getPools(params?: {
    page?: number;
    pageSize?: number;
    query?: string;
    sortBy?: string;
    filterBy?: string;
  }): Promise<{ total: number; data: MeteoraPoolRaw[]; has_more: boolean }> {
    const qs = new URLSearchParams();
    if (params?.pageSize) qs.set('page_size', String(params.pageSize));
    if (params?.query) qs.set('query', params.query);
    if (params?.sortBy) qs.set('sort_by', params.sortBy);
    if (params?.filterBy) qs.set('filter_by', params.filterBy);

    const path = `/pools${qs.size > 0 ? `?${qs.toString()}` : ''}`;
    const result = await this.fetch<{ total: number; data: MeteoraPoolRaw[]; has_more: boolean }>(path);

    // Auto-populate token cache from API response
    this._cacheTokens(result.data);

    return result;
  }

  /**
   * Fetch a single pool by address.
   */
  async getPool(address: string): Promise<MeteoraPoolRaw> {
    const result = await this.getPools({
      pageSize: 1,
      filterBy: `pool_address=${address}`,
    });

    if (result.data.length === 0) {
      throw new NetworkError(`Pool not found: ${address}`);
    }

    return result.data[0];
  }

  // --------------------------------------------------------------------------
  // Discover — structured results with quality gates
  // --------------------------------------------------------------------------

  /**
   * Discover pools with quality gates applied.
   *
   * Fetches 100 pools sorted by the chosen metric, then applies local gates
   * to filter out dust/low-quality pools. Returns structured DiscoveredPool
   * objects ready for display or agent consumption.
   *
   * @param query    Optional — token symbol, pair name, mint, or pool address.
   * @param config   Override default gates and sort.
   * @returns        Gated and sorted DiscoveredPool array.
   */
  async discover(
    query?: string,
    config?: Partial<DiscoverConfig>,
  ): Promise<DiscoveredPool[]> {
    const cfg = { ...DEFAULT_DISCOVER_CONFIG, ...config };
    const sortBy = `${cfg.defaultSort}:desc`;

    const result = await this.getPools({
      query,
      pageSize: 100,
      sortBy,
      filterBy: 'is_blacklisted=false',
    });

    const now = Date.now();

    return result.data
      .filter((p) =>
        p.active_tvl >= cfg.minActiveTvl &&
        p.swap_count >= cfg.minSwapCount &&
        p.unique_traders >= cfg.minTraders
      )
      .map((p): DiscoveredPool => {
        const symX = (p.token_x.symbol || p.token_x.address.slice(0, 6)).toUpperCase();
        const symY = (p.token_y.symbol || p.token_y.address.slice(0, 6)).toUpperCase();
        return {
        pool_address: p.pool_address,
        name: p.name || `${symX}-${symY}`,
        token_x: symX,
        token_y: symY,
        token_x_mint: p.token_x.address,
        token_y_mint: p.token_y.address,
        bin_step: p.dlmm_params?.bin_step ?? p.damm_v2_params?.bin_step ?? 0,
        pool_type: p.pool_type,
        avg_fee: p.avg_fee,
        fee_24h: p.fee,
        fee_active_tvl_ratio: p.fee_active_tvl_ratio,
        avg_volume: p.avg_volume,
        volume_24h: p.volume,
        active_tvl: p.active_tvl,
        tvl: p.tvl,
        volatility: p.volatility,
        swap_count: p.swap_count,
        unique_traders: p.unique_traders,
        open_positions: p.open_positions,
        active_positions: p.active_positions,
        pool_price: p.pool_price,
        pool_age_ms: now - p.pool_created_at,
        has_farm: p.has_farm,
        fee_pct: p.fee_pct,
        fee_change_pct: p.fee_change_pct,
        volume_change_pct: p.volume_change_pct,
        active_tvl_change_pct: p.active_tvl_change_pct,
      };
      });
  }

  // --------------------------------------------------------------------------
  // Pool detail — structured PoolInfo
  // --------------------------------------------------------------------------

  /**
   * Get detailed info for a specific pool.
   * Returns PoolInfo (no wallet/DLMM needed — read-only).
   */
  async getPoolInfo(address: string): Promise<import('./types.js').PoolInfo> {
    const raw = await this.getPool(address);
    const now = Date.now();

    const symX = (raw.token_x.symbol || raw.token_x.address.slice(0, 6)).toUpperCase();
    const symY = (raw.token_y.symbol || raw.token_y.address.slice(0, 6)).toUpperCase();

    return {
      pool_address: raw.pool_address,
      name: raw.name || `${symX}-${symY}`,
      token_x: symX,
      token_y: symY,
      token_x_mint: raw.token_x.address,
      token_y_mint: raw.token_y.address,
      bin_step: raw.dlmm_params?.bin_step ?? raw.damm_v2_params?.bin_step ?? 0,
      pool_type: raw.pool_type,
      active_bin: 0, // resolved by DLMM SDK when wallet available
      pool_price: raw.pool_price,
      fee_pct: raw.fee_pct,
      tvl: raw.tvl,
      active_tvl: raw.active_tvl,
      fee_24h: raw.fee,
      avg_fee: raw.avg_fee,
      fee_active_tvl_ratio: raw.fee_active_tvl_ratio,
      volume_24h: raw.volume,
      avg_volume: raw.avg_volume,
      volatility: raw.volatility,
      swap_count: raw.swap_count,
      unique_traders: raw.unique_traders,
      open_positions: raw.open_positions,
      active_positions: raw.active_positions,
      active_positions_pct: raw.active_positions_pct,
      has_farm: raw.has_farm,
      pool_age_ms: now - raw.pool_created_at,
      // Legacy compat
      address: raw.pool_address,
    };
  }

  // --------------------------------------------------------------------------
  // Cache management
  // --------------------------------------------------------------------------

  /** Invalidate the HTTP response cache (force fresh fetch). */
  clearCache(): void {
    this.cache.clear();
  }

  // --------------------------------------------------------------------------
  // Internal — auto-populate token registry
  // --------------------------------------------------------------------------

  private _cacheTokens(pools: MeteoraPoolRaw[]): void {
    if (!this._tokenRegistry || pools.length === 0) return;

    const tokens: { address: string; symbol: string; name: string; decimals: number; is_verified: boolean }[] = [];

    for (const p of pools) {
      tokens.push(p.token_x, p.token_y);
    }

    this._tokenRegistry.populateFromApi(tokens);
  }
}
