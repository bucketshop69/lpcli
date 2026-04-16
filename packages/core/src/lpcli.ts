// ============================================================================
// LPCLI Main Class — @lpcli/core
//
// Facade that wires config, wallet, DLMM, Meteora API, token cache,
// and funding ops. CLI commands and agents should go through this class.
// ============================================================================

import type {
  DiscoveredPool,
  PoolInfo,
  FundedOpenResult,
  FundedCloseResult,
  FundedClaimResult,
  ReadinessStatus,
  DiscoverConfig,
} from './types.js';
import type { LPCLIConfig, FundingToken } from './config.js';
import { loadConfig } from './config.js';
import { MeteoraClient, DEFAULT_DISCOVER_CONFIG } from './client.js';
import { WalletService } from './wallet.js';
import { DLMMService } from './dlmm.js';
import { jupiterSwap } from './jup.js';
import type { JupiterSwapResult } from './jup.js';
import { fundedOpen, fundedClose, fundedClaim } from './funding.js';
import { TokenRegistry } from './tokens.js';
import { Connection } from '@solana/web3.js';

export class LPCLI {
  public meteora: MeteoraClient;
  public config: LPCLIConfig;
  /** Token cache — auto-populated from API responses. */
  public tokenRegistry: TokenRegistry;
  /** Lazily initialised — call `getWallet()` to trigger init. */
  private _wallet: WalletService | undefined;
  public dlmm: DLMMService | undefined;

  constructor(config?: Partial<LPCLIConfig>) {
    this.config = { ...loadConfig(), ...config };
    this.meteora = new MeteoraClient({ rpcUrl: this.config.rpcUrl, cluster: this.config.cluster });

    // Init token registry with a read-only connection (for Metaplex fallback)
    const readRpc = this.config.readRpcUrl || this.config.rpcUrl;
    this.tokenRegistry = new TokenRegistry(new Connection(readRpc, 'confirmed'));

    // Wire token registry to API client for auto-population
    this.meteora.setTokenRegistry(this.tokenRegistry);
  }

  /**
   * Pre-flight readiness check — can we sign transactions?
   *
   * Verifies: OWS SDK importable → wallet exists → has Solana account.
   * Cheap to call (no RPC), safe to call repeatedly.
   */
  async checkReady(): Promise<ReadinessStatus> {
    // 1. Can we import OWS?
    let ows: { getWallet(name: string): { accounts: { chainId: string; address: string }[] } };
    try {
      const dynamicImport = new Function('specifier', 'return import(specifier)');
      ows = await dynamicImport('@open-wallet-standard/core');
    } catch {
      return { ready: false, ows_installed: false, wallet_found: false, error: 'OWS SDK not installed. Run: npm install -g @open-wallet-standard/core' };
    }

    // 2. Does the named wallet exist?
    let wallet: { accounts: { chainId: string; address: string }[] };
    try {
      wallet = ows.getWallet(this.config.wallet);
    } catch {
      return { ready: false, ows_installed: true, wallet_found: false, error: `OWS wallet "${this.config.wallet}" not found. Run: ows wallet create --name ${this.config.wallet}` };
    }

    // 3. Does it have a Solana account?
    const solanaAccount = wallet.accounts.find(a => a.chainId.startsWith('solana:'));
    if (!solanaAccount) {
      return { ready: false, ows_installed: true, wallet_found: true, error: `OWS wallet "${this.config.wallet}" has no Solana account.` };
    }

    return { ready: true, ows_installed: true, wallet_found: true, address: solanaAccount.address };
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
        tokenRegistry: this.tokenRegistry,
      });
    }
    return this._wallet;
  }

  /** Get the funding token config. */
  getFundingToken(): FundingToken {
    return this.config.fundingToken;
  }

  /** Get discover config from config file, merged with defaults. */
  getDiscoverConfig(): DiscoverConfig {
    return { ...DEFAULT_DISCOVER_CONFIG, ...this.config.discover };
  }

  // ============================================================================
  // Pool discovery
  // ============================================================================

  /**
   * Discover pools with quality gates.
   *
   * Returns structured DiscoveredPool array — ready for CLI display or agent use.
   * Token cache is auto-populated from API response.
   *
   * @param query  Optional — token symbol, pair name, mint, or pool address.
   * @param config Override default gates and sort.
   */
  async discoverPools(
    query?: string,
    config?: Partial<DiscoverConfig>,
  ): Promise<DiscoveredPool[]> {
    const cfg = { ...this.getDiscoverConfig(), ...config };
    return this.meteora.discover(query, cfg);
  }

  /**
   * Get detailed info for a specific pool.
   * Read-only — no wallet needed.
   */
  async getPoolInfo(address: string): Promise<PoolInfo> {
    const info = await this.meteora.getPoolInfo(address);

    // Resolve active bin from SDK when wallet/DLMM is initialised.
    if (this.dlmm) {
      const meta = await this.dlmm.getPoolMeta(address);
      info.active_bin = meta.activeBinId;
    }

    return info;
  }

  // ============================================================================
  // Funding-aware LP operations
  // ============================================================================

  /**
   * Open a position with automatic funding-token swap.
   *
   * Flow: check balances → calculate split → swap → open position.
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
   */
  async claimToFunding(positionAddress: string, pool?: string): Promise<FundedClaimResult> {
    const wallet = await this.getWallet();
    const resolvedPool = pool ?? await this.dlmm!.resolvePoolForPosition(positionAddress);
    return fundedClaim({
      positionAddress,
      pool: resolvedPool,
      config: this.config,
      wallet,
      dlmm: this.dlmm!,
    });
  }

  // ============================================================================
  // Low-level swap helpers
  // ============================================================================

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
