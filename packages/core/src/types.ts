// ============================================================================
// Shared Types — @lpcli/core
// ============================================================================

// ---------------------------------------------------------------------------
// Token info returned by pool-discovery API (richer than dlmm API)
// ---------------------------------------------------------------------------

export interface MeteoraTokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  icon?: string;
  is_verified: boolean;
  holders: number;
  freeze_authority_disabled: boolean;
  mint_authority_disabled?: boolean;
  has_freeze_authority?: boolean;
  has_mint_authority?: boolean;
  total_supply: number;
  price: number;
  market_cap: number;
  fdv?: number;
  created_at?: number;
  tags?: string[];
  warnings?: { type: string; message: string; severity: string }[];
  organic_score?: number;
  organic_score_label?: string;
  token_program?: string;
  top_holders_pct?: number;
  dev_balance_pct?: number;
}

// ---------------------------------------------------------------------------
// Raw pool from pool-discovery API
// ---------------------------------------------------------------------------

export interface MeteoraPoolRaw {
  pool_address: string;
  name: string;
  token_x: MeteoraTokenInfo;
  token_y: MeteoraTokenInfo;
  pool_type: 'dlmm' | 'damm_v2';
  fee_pct: number;
  pool_created_at: number;
  is_blacklisted: boolean;
  dlmm_params: { bin_step: number } | null;
  damm_v2_params: { bin_step: number } | null;

  // TVL
  tvl: number;
  tvl_change_pct: number;
  active_tvl: number;
  active_tvl_change_pct: number;

  // Fee metrics
  fee: number;
  fee_change_pct: number;
  avg_fee: number;
  fee_tvl_ratio: number;
  fee_tvl_ratio_change_pct: number;
  fee_active_tvl_ratio: number;
  fee_active_tvl_ratio_change_pct: number;

  // Volume metrics
  volume: number;
  volume_change_pct: number;
  avg_volume: number;
  volume_tvl_ratio: number;
  volume_tvl_ratio_change_pct: number;
  volume_active_tvl_ratio: number;
  volume_active_tvl_ratio_change_pct: number;

  // Trading activity
  swap_count: number;
  swap_count_change_pct: number;
  avg_swap_count: number;
  unique_traders: number;
  unique_traders_change_pct: number;

  // LP activity
  unique_lps: number;
  unique_lps_change_pct: number;
  total_lps: number;
  total_lps_change_pct: number;
  net_deposits: number;
  net_deposits_change_pct: number;
  total_deposits: number;
  total_withdraws: number;

  // Position stats
  open_positions: number;
  active_positions: number;
  active_positions_pct: number;
  positions_created: number;
  positions_created_change_pct: number;

  // Price & volatility
  pool_price: number;
  pool_price_change_pct: number;
  max_price: number;
  min_price: number;
  volatility: number;
  correlation: number;
  price_trend: number[];

  // Token holder stats
  base_token_holders: number;
  base_token_holders_change_pct: number;
  base_token_market_cap_change_pct: number;
  base_token_fdv_change_pct: number;

  // Farm & misc
  has_farm: boolean;
  dynamic_fee_pct: number;
  permanent_lock_liquidity_pct: number;

  // Legacy compat — old API had these, some callers may still use
  /** @deprecated Use pool_address */
  address?: string;
  /** @deprecated Use pool_price */
  current_price?: number;
  /** @deprecated Use fee_pct */
  apr?: number;
  /** @deprecated */
  apy?: number;
  /** @deprecated */
  farm_apr?: number;
}

/**
 * Processed pool from discover — agent-friendly structured data.
 * All fields are pre-computed; no further API calls needed to display or act on.
 */
export interface DiscoveredPool {
  /** Pool on-chain address. */
  pool_address: string;
  /** Human-readable pair name, e.g. "SOL-USDC". */
  name: string;
  /** Token X symbol. */
  token_x: string;
  /** Token Y symbol. */
  token_y: string;
  /** Token X mint address. */
  token_x_mint: string;
  /** Token Y mint address. */
  token_y_mint: string;
  /** Bin step in bps (DLMM only). */
  bin_step: number;
  /** Pool type: dlmm or damm_v2. */
  pool_type: 'dlmm' | 'damm_v2';

  // Fee metrics (24h)
  /** Average fees per minute in USD. */
  avg_fee: number;
  /** Total fees in 24h in USD. */
  fee_24h: number;
  /** Fees / Active TVL ratio (24h). */
  fee_active_tvl_ratio: number;

  // Volume metrics (24h)
  /** Average volume per minute in USD. */
  avg_volume: number;
  /** Total volume in 24h in USD. */
  volume_24h: number;

  // TVL
  /** Active TVL (in-range liquidity only). */
  active_tvl: number;
  /** Total TVL. */
  tvl: number;

  // Risk / activity
  /** Price volatility (24h). */
  volatility: number;
  /** Number of swaps in 24h. */
  swap_count: number;
  /** Unique traders in 24h. */
  unique_traders: number;
  /** Open positions count. */
  open_positions: number;
  /** In-range positions count. */
  active_positions: number;

  // Pool info
  /** Current pool price (X in terms of Y). */
  pool_price: number;
  /** Pool age in ms since creation. */
  pool_age_ms: number;
  /** Has active farming rewards. */
  has_farm: boolean;
  /** Fee percentage. */
  fee_pct: number;

  // Change indicators (24h)
  fee_change_pct: number;
  volume_change_pct: number;
  active_tvl_change_pct: number;
}

/** @deprecated Use DiscoveredPool instead. Kept for backwards compat during migration. */
export type ScoredPool = DiscoveredPool;

export interface Position {
  address: string;
  pool: string;
  pool_name: string;
  status: 'in_range' | 'out_of_range_above' | 'out_of_range_below' | 'closed';
  // Token info
  token_x_mint: string;
  token_y_mint: string;
  token_x_decimals: number;
  token_y_decimals: number;
  // Current value (raw smallest unit)
  current_value_x: number;
  current_value_y: number;
  // UI-adjusted amounts
  current_value_x_ui: number;
  current_value_y_ui: number;
  // Fees (raw)
  fees_earned_x: number;
  fees_earned_y: number;
  // Fees (UI-adjusted)
  fees_earned_x_ui: number;
  fees_earned_y_ui: number;
  // Range
  range_low: number;
  range_high: number;
  current_price: number;
  total_bins: number;
  bin_step: number;
  // Deprecated — always 0, use getPositionDetail for entry tracking
  deposited_x: number;
  deposited_y: number;
  pnl_usd: number | null;
  opened_at: number;
}

export interface PoolInfo {
  pool_address: string;
  name: string;
  token_x: string;
  token_y: string;
  token_x_mint: string;
  token_y_mint: string;
  bin_step: number;
  pool_type: 'dlmm' | 'damm_v2';
  active_bin: number;
  pool_price: number;
  fee_pct: number;
  tvl: number;
  active_tvl: number;
  // Fee/volume (24h)
  fee_24h: number;
  avg_fee: number;
  fee_active_tvl_ratio: number;
  volume_24h: number;
  avg_volume: number;
  // Risk & activity
  volatility: number;
  swap_count: number;
  unique_traders: number;
  open_positions: number;
  active_positions: number;
  active_positions_pct: number;
  // Misc
  has_farm: boolean;
  pool_age_ms: number;
  /** @deprecated Use pool_address */
  address?: string;
}

/**
 * On-chain pool metadata resolved from the DLMM SDK.
 * Used by funding-aware operations to plan swaps and splits.
 */
export interface PoolMeta {
  pool: string;
  tokenXMint: string;
  tokenYMint: string;
  tokenXDecimals: number;
  tokenYDecimals: number;
  activeBinId: number;
  binStep: number;
  /** Price of token X denominated in token Y (from active bin). */
  activePrice: number;
}

/**
 * Describes a planned or executed swap.
 */
export interface SwapStep {
  inputMint: string;
  outputMint: string;
  /** Amount in raw smallest unit. */
  amount: number;
}

/**
 * Result of a funding-aware open: includes swap(s) + position.
 */
export interface FundedOpenResult {
  swaps: import('./jup.js').JupiterSwapResult[];
  position: OpenPositionResult;
}

/**
 * Result of a funding-aware close: includes close + swap-back(s).
 */
export interface FundedCloseResult {
  close: ClosePositionResult;
  swaps: import('./jup.js').JupiterSwapResult[];
  /** Token metadata for formatting swap amounts (mint → { symbol, decimals }). */
  tokenMeta: Record<string, { symbol: string; decimals: number }>;
}

/**
 * Result of a funding-aware claim: includes claim + swap-back(s).
 */
export interface FundedClaimResult {
  claim: { claimedX: number; claimedY: number; tx: string };
  swaps: import('./jup.js').JupiterSwapResult[];
}

export interface OpenPositionResult {
  position: string;
  range_low: number;
  range_high: number;
  deposited_x: number;
  deposited_y: number;
  /** UI-friendly deposited amounts (decimal-adjusted). */
  deposited_x_ui: number;
  deposited_y_ui: number;
  token_x_symbol: string;
  token_y_symbol: string;
  tx: string;
}

export interface ClosePositionResult {
  withdrawn_x: number;
  withdrawn_y: number;
  claimed_fees_x: number;
  claimed_fees_y: number;
  /** UI-friendly amounts (decimal-adjusted). */
  withdrawn_x_ui: number;
  withdrawn_y_ui: number;
  claimed_fees_x_ui: number;
  claimed_fees_y_ui: number;
  token_x_symbol: string;
  token_y_symbol: string;
  tx: string;
}

/**
 * Result of a system readiness check.
 * Agents and MCP servers call this before attempting wallet operations.
 */
export interface ReadinessStatus {
  /** True when wallet is initialised and ready to sign. */
  ready: boolean;
  /** OWS SDK can be imported. */
  ows_installed: boolean;
  /** Named wallet exists in OWS. */
  wallet_found: boolean;
  /** Solana public key (base58) when wallet is found. */
  address?: string;
  /** Human-readable error when not ready. */
  error?: string;
}

export interface MeteoraClientOptions {
  rpcUrl: string;
  cluster: 'mainnet' | 'devnet';
}

/**
 * Configurable gates for discover — pools that fail any gate are excluded.
 * Stored in config.json under `discover` key.
 */
export interface DiscoverConfig {
  /** Results per page in interactive UI. Default 10. */
  pageSize: number;
  /** Server-side sort field. Default 'fee_active_tvl_ratio'. */
  defaultSort: string;
  /** Minimum active TVL in USD. Default 50000. */
  minActiveTvl: number;
  /** Minimum swap count (24h). Default 200. */
  minSwapCount: number;
  /** Minimum unique traders (24h). Default 50. */
  minTraders: number;
}

export interface ScoringWeights {
  feeYield: number;
  volumeRatio: number;
  tvl: number;
}
