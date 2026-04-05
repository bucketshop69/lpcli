// ============================================================================
// LPCLI Main Class — @lpcli/core
// ============================================================================

import type { ScoredPool, PoolInfo } from './types.js';
import type { LPCLIConfig, FundingToken } from './config.js';
import { loadConfig } from './config.js';
import { MeteoraClient } from './client.js';
import { WalletService } from './wallet.js';
import { DLMMService } from './dlmm.js';
import { jupiterSwap, SOL_MINT } from './jup.js';
import type { JupiterSwapResult } from './jup.js';
import type { OpenPositionResult, ClosePositionResult } from './types.js';
import { rankPools, getVolume24, getFees24 } from './scoring.js';

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

  // ============================================================================
  // Funding token operations
  // ============================================================================

  /**
   * Swap funding token → target token via Jupiter.
   * Used before opening/adding to a position.
   */
  async swapFromFunding(params: {
    outputMint: string;
    amount: number;
  }): Promise<JupiterSwapResult> {
    const wallet = await this.getWallet();
    const funding = this.config.fundingToken;
    return jupiterSwap({
      inputMint: funding.mint,
      outputMint: params.outputMint,
      amount: params.amount,
    }, wallet);
  }

  /**
   * Swap target token → funding token via Jupiter.
   * Used after closing a position.
   */
  async swapToFunding(params: {
    inputMint: string;
    amount: number;
  }): Promise<JupiterSwapResult> {
    const wallet = await this.getWallet();
    const funding = this.config.fundingToken;
    return jupiterSwap({
      inputMint: params.inputMint,
      outputMint: funding.mint,
      amount: params.amount,
    }, wallet);
  }

  /**
   * Open a position with funding token auto-swap.
   *
   * Flow: funding token → swap to pool token(s) → open position
   */
  async openWithFunding(params: {
    pool: string;
    amount: number;
    strategy?: 'spot' | 'bidask' | 'curve';
    widthBins?: number;
  }): Promise<{ swap: JupiterSwapResult; position: OpenPositionResult }> {
    const wallet = await this.getWallet();
    const poolInfo = await this.getPoolInfo(params.pool);
    const raw = await this.meteora.getPool(params.pool);
    const funding = this.config.fundingToken;

    // Determine which pool token to swap into
    // If funding token is one of the pool tokens, swap to the other
    // Otherwise swap to token_y (typically the quote token)
    let swapOutputMint: string;
    if (raw.token_x.mint === funding.mint) {
      swapOutputMint = raw.token_y.mint;
    } else if (raw.token_y.mint === funding.mint) {
      swapOutputMint = raw.token_x.mint;
    } else {
      swapOutputMint = raw.token_y.mint;
    }

    // Swap funding → pool token
    const swap = await jupiterSwap({
      inputMint: funding.mint,
      outputMint: swapOutputMint,
      amount: params.amount,
    }, wallet);

    // Open position with swapped amount
    const outputAmount = Number(swap.outputAmountResult ?? swap.outAmount);
    const dlmm = this.dlmm!;

    // Determine amountX/amountY based on which token we swapped into
    const isTokenX = swapOutputMint === raw.token_x.mint;
    const position = await dlmm.openPosition({
      pool: params.pool,
      amountX: isTokenX ? outputAmount : 0,
      amountY: isTokenX ? 0 : outputAmount,
      strategy: params.strategy,
      widthBins: params.widthBins,
    });

    return { swap, position };
  }

  /**
   * Close a position and swap proceeds back to funding token.
   *
   * Flow: close position → swap proceeds → funding token
   */
  async closeToFunding(positionAddress: string): Promise<{
    close: ClosePositionResult;
    swaps: JupiterSwapResult[];
  }> {
    const wallet = await this.getWallet();
    const dlmm = this.dlmm!;
    const funding = this.config.fundingToken;

    // Close position
    const close = await dlmm.closePosition(positionAddress);

    // Find the position's pool to get token mints
    const positions = await dlmm.getPositions(wallet.getPublicKey().toBase58());
    // Position is now closed, but we know the pool from the close result
    // We need to get pool info to know the mints — get from positions list or pool
    // For now, swap back any non-funding tokens
    const swaps: JupiterSwapResult[] = [];

    // Swap token X proceeds if non-zero and not the funding token
    if (close.withdrawn_x > 0) {
      try {
        const swap = await this.swapToFunding({
          inputMint: SOL_MINT, // TODO: resolve actual token_x mint from pool
          amount: close.withdrawn_x,
        });
        swaps.push(swap);
      } catch {
        // Swap failed — tokens remain in wallet
      }
    }

    return { close, swaps };
  }
}
