// ============================================================================
// Shared Types — @lpcli/core
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

export interface MeteoraClientOptions {
  rpcUrl: string;
  cluster: 'mainnet' | 'devnet';
}

export interface WalletOptions {
  rpcUrl: string;
  privateKey?: string;   // base58 encoded or file path
  owsWalletName?: string; // OWS wallet name (takes priority over privateKey)
}

export interface LPCLIOptions {
  rpcUrl: string;
  cluster: 'mainnet' | 'devnet';
  privateKey?: string;
}

export interface ScoringWeights {
  feeYield: number;
  volumeRatio: number;
  tvl: number;
}
