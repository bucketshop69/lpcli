// ============================================================================
// LPCLI Main Class — @lpcli/core
// ============================================================================

import type { ScoredPool, PoolInfo, LPCLIOptions } from './types.js';
import { MeteoraClient } from './client.js';
import { WalletService } from './wallet.js';
import { DLMMService } from './dlmm.js';
import { rankPools, getVolume24, getFees24 } from './scoring.js';

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
