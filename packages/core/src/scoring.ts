// ============================================================================
// Scoring Engine — @lpcli/core
// ============================================================================

import type { MeteoraPoolRaw, ScoredPool, ScoringWeights } from './types.js';

const TVL_GATE = 10_000; // $10K minimum TVL to be considered

export const DEFAULT_WEIGHTS: ScoringWeights = {
  feeYield: 0.4,
  volumeRatio: 0.3,
  tvl: 0.3,
};

export function getFeeYield(feeTvlRatio: number | Record<string, number>): number {
  if (typeof feeTvlRatio === 'number') return feeTvlRatio;
  return feeTvlRatio['24h'] ?? feeTvlRatio['1h'] ?? 0;
}

export function getVolume24(volume: Record<string, number>): number {
  return volume['24h'] ?? 0;
}

export function getFees24(fees: Record<string, number>): number {
  return fees['24h'] ?? 0;
}

/**
 * Momentum: volume_1h vs volume_24h/24 baseline.
 * A ratio < 0.5 means the pool is cooling off → apply 20% score penalty.
 * A ratio > 2.0 is capped at 2.0 to prevent a single whale trade dominating.
 *
 * WARNING: This is a heuristic, not proven predictive.
 * TODO: Backtest this metric against actual pool performance.
 */
export function computeMomentum(pool: MeteoraPoolRaw): number {
  const h24 = pool.volume["24h"] ?? 0;
  const h1 = pool.volume["1h"] ?? 0;
  const baseline = h24 / 24;
  if (baseline === 0) return 1.0;
  const ratio = h1 / baseline;
  if (ratio < 0.5) return 0.8; // 20% penalty
  return Math.min(ratio, 2.0);
}

export function scorePool(pool: MeteoraPoolRaw, weights: ScoringWeights = DEFAULT_WEIGHTS): number {
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
