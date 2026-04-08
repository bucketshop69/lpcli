// ============================================================================
// LPCLI Main Class — @lpcli/core
//
// Facade that wires config, wallet, DLMM, Meteora API, and funding ops.
// CLI commands and agents should go through this class.
// ============================================================================

import type { ScoredPool, PoolInfo, FundedOpenResult, FundedCloseResult, FundedClaimResult } from './types.js';
import type { LPCLIConfig, FundingToken } from './config.js';
import { loadConfig } from './config.js';
import { MeteoraClient } from './client.js';
import { WalletService } from './wallet.js';
import { DLMMService } from './dlmm.js';
import { jupiterSwap } from './jup.js';
import type { JupiterSwapResult } from './jup.js';
import { rankPools, getVolume24, getFees24 } from './scoring.js';
import { fundedOpen, fundedClose, fundedClaim } from './funding.js';

export class LPCLI {
  public meteora: MeteoraClient;
  public config: LPCLIConfig;
  /** Lazily initialised — call `getWallet()` to trigger init. */
  private _wallet: WalletService | undefined;
  public dlmm: DLMMService | undefined;

  constructor(config?: Partial<LPCLIConfig>) {
    this.config = { ...loadConfig(), ...config };
    this.meteora = new MeteoraClient({ rpcUrl: this.config.rpcUrl, cluster: this.config.cluster });
  }

  /**
   * Initialise (or return the cached) WalletService.
   * Uses OWS wallet name from config.
   */
  async getWallet(): Promise<WalletService> {
    if (!this._wallet) {
      this._wallet = await WalletService.init(this.config.wallet, this.config.rpcUrl);
      this.dlmm = new DLMMService({
        rpcUrl: this.config.rpcUrl,
        readRpcUrl: this.config.readRpcUrl,
        wallet: this._wallet,
        cluster: this.config.cluster,
      });
    }
    return this._wallet;
  }

  /** Get the funding token config. */
  getFundingToken(): FundingToken {
    return this.config.fundingToken;
  }

  // ============================================================================
  // Pool discovery
  // ============================================================================

  /**
   * Discover and rank DLMM pools for a given token pair.
   */
  async discoverPools(
    token?: string,
    sortBy: 'score' | 'fee_yield' | 'volume' | 'tvl' = 'score',
    limit = 10
  ): Promise<ScoredPool[]> {
    const sortMap: Record<string, string> = {
      score: undefined as unknown as string,
      fee_yield: 'fee_24h:desc',
      volume: 'volume_24h:desc',
      tvl: 'tvl:desc',
    };

    const filter = 'is_blacklisted=false';

    const result = await this.meteora.getPools({
      query: token,
      pageSize: 100,
      sortBy: sortMap[sortBy],
      filterBy: filter,
    });

    const ranked = rankPools(result.data);

    if (sortBy === 'score') {
      return ranked.slice(0, limit);
    }

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

    // Resolve active bin from SDK when wallet/DLMM is initialised.
    let activeBin = 0;
    if (this.dlmm) {
      const meta = await this.dlmm.getPoolMeta(address);
      activeBin = meta.activeBinId;
    }

    return {
      address: raw.address,
      name: raw.name,
      token_x: raw.token_x.symbol,
      token_y: raw.token_y.symbol,
      bin_step: raw.pool_config.bin_step,
      active_bin: activeBin,
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

  // ============================================================================
  // Funding-aware LP operations
  // ============================================================================

  /**
   * Open a position with automatic funding-token swap.
   *
   * Flow: check balances → calculate split → swap → open position.
   *
   * @param pool      Pool address.
   * @param amount    Budget in funding token's smallest unit.
   * @param ratioX    Fraction for token X (0.0–1.0). Default 0.5 (balanced).
   * @param strategy  Distribution strategy. Default 'spot'.
   * @param widthBins Half-width in bins. Default: auto from bin step.
   */
  async openWithFunding(params: {
    pool: string;
    amount: number;
    ratioX?: number;
    strategy?: 'spot' | 'bidask' | 'curve';
    widthBins?: number;
  }): Promise<FundedOpenResult> {
    const wallet = await this.getWallet();
    return fundedOpen({
      pool: params.pool,
      amount: params.amount,
      config: this.config,
      wallet,
      dlmm: this.dlmm!,
      ratioX: params.ratioX,
      strategy: params.strategy,
      widthBins: params.widthBins,
    });
  }

  /**
   * Close a position and swap proceeds back to funding token.
   *
   * Flow: close position → check balances → swap pool tokens → funding token.
   *
   * @param positionAddress The position to close.
   * @param pool            The pool address (needed to resolve token mints).
   */
  async closeToFunding(positionAddress: string, pool: string): Promise<FundedCloseResult> {
    const wallet = await this.getWallet();
    return fundedClose({
      positionAddress,
      pool,
      config: this.config,
      wallet,
      dlmm: this.dlmm!,
    });
  }

  /**
   * Claim fees and swap them back to funding token.
   *
   * Flow: claim fees → check balances → swap fee tokens → funding token.
   *
   * @param positionAddress The position to claim from.
   * @param pool            The pool address (needed to resolve token mints).
   */
  async claimToFunding(positionAddress: string, pool: string): Promise<FundedClaimResult> {
    const wallet = await this.getWallet();
    return fundedClaim({
      positionAddress,
      pool,
      config: this.config,
      wallet,
      dlmm: this.dlmm!,
    });
  }

  // ============================================================================
  // Low-level swap helpers (kept for direct use / backwards compat)
  // ============================================================================

  /**
   * Swap funding token → target token via Jupiter.
   */
  async swapFromFunding(params: {
    outputMint: string;
    amount: number;
  }): Promise<JupiterSwapResult> {
    const wallet = await this.getWallet();
    return jupiterSwap({
      inputMint: this.config.fundingToken.mint,
      outputMint: params.outputMint,
      amount: params.amount,
    }, wallet);
  }

  /**
   * Swap target token → funding token via Jupiter.
   */
  async swapToFunding(params: {
    inputMint: string;
    amount: number;
  }): Promise<JupiterSwapResult> {
    const wallet = await this.getWallet();
    return jupiterSwap({
      inputMint: params.inputMint,
      outputMint: this.config.fundingToken.mint,
      amount: params.amount,
    }, wallet);
  }
}
