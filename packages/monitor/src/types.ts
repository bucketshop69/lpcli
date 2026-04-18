// ============================================================================
// Monitor Types — @lpcli/monitor
//
// Watcher definitions, conditions, and actions.
// All types are JSON-serializable for disk persistence.
// ============================================================================

// ============================================================================
// Conditions — what to watch
// ============================================================================

export interface RsiCondition {
  type: 'rsi';
  /** Market symbol (e.g. SOL, BTC) — resolved via Pacifica klines */
  symbol: string;
  /** Kline timeframe */
  timeframe: string;
  op: '>' | '<';
  value: number;
}

export interface PriceCondition {
  type: 'price';
  /** Market symbol (e.g. SOL, BTC) — resolved via Pacifica prices */
  symbol: string;
  op: '>' | '<';
  value: number;
}

export interface FundingRateCondition {
  type: 'funding_rate';
  /** Market symbol */
  symbol: string;
  op: '>' | '<';
  /** Absolute funding rate threshold (e.g. 0.01 = 1%) */
  value: number;
}

export interface PositionStatusCondition {
  type: 'position_status';
  /** Meteora pool address */
  pool: string;
  /** Match any out-of-range status, or specific */
  status: 'out_of_range' | 'in_range';
}

export interface HasPositionCondition {
  type: 'has_position';
  protocol: 'pacifica' | 'meteora';
  /** Symbol for pacifica, pool address for meteora */
  identifier: string;
}

export type Condition =
  | RsiCondition
  | PriceCondition
  | FundingRateCondition
  | PositionStatusCondition
  | HasPositionCondition;

// ============================================================================
// Actions — what to do when triggered
// ============================================================================

export interface AlertAction {
  type: 'alert';
  message?: string;
}

export interface CloseLpAction {
  type: 'close_lp';
  /** Meteora pool address */
  pool: string;
}

export interface ClosePerpAction {
  type: 'close_perp';
  /** Pacifica market symbol */
  symbol: string;
}

export interface TradeAction {
  type: 'trade';
  /** Pacifica market symbol */
  symbol: string;
  side: 'long' | 'short';
  /** Size in asset units */
  amount: number;
}

export interface WebhookAction {
  type: 'webhook';
  url: string;
  body?: Record<string, unknown>;
}

export type Action =
  | AlertAction
  | CloseLpAction
  | ClosePerpAction
  | TradeAction
  | WebhookAction;

// ============================================================================
// Watcher — a complete monitoring job
// ============================================================================

export interface Watcher {
  id: string;
  /** Human-readable label */
  name: string;
  /** ALL conditions must be true to trigger (implicit AND) */
  conditions: Condition[];
  action: Action;
  /** Polling interval (e.g. '1m', '5m', '15m') */
  interval: string;
  /** 'one_shot' disables after first trigger, 'repeating' keeps firing */
  mode: 'one_shot' | 'repeating';
  /** Minimum seconds between repeated triggers (for 'repeating' mode) */
  cooldownSeconds?: number;
  enabled: boolean;
  createdAt: number;
  lastCheckedAt?: number;
  lastTriggeredAt?: number;
  /** Number of times this watcher has triggered */
  triggerCount: number;
  /** Last error message, if any */
  lastError?: string;
}

// ============================================================================
// Engine events — for TUI/CLI to subscribe to
// ============================================================================

export interface WatcherEvent {
  type: 'checked' | 'triggered' | 'error' | 'action_executed' | 'action_failed';
  watcherId: string;
  watcherName: string;
  timestamp: number;
  detail?: string;
}

// ============================================================================
// Interval parsing
// ============================================================================

const INTERVAL_MS: Record<string, number> = {
  '10s': 10_000,
  '30s': 30_000,
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
};

export const VALID_INTERVALS = Object.keys(INTERVAL_MS);

export function intervalToMs(interval: string): number {
  const ms = INTERVAL_MS[interval];
  if (!ms) throw new Error(`Invalid interval: ${interval}. Valid: ${VALID_INTERVALS.join(', ')}`);
  return ms;
}

/**
 * Get the most recent candle close time for a given interval.
 *
 * Candles are aligned to UTC epoch boundaries:
 *   5m candles close at :00, :05, :10, ...
 *   1h candles close at the top of each hour
 *
 * Returns the timestamp (ms) of the last completed candle's close.
 * We add a small buffer (2s) so the exchange has time to finalize the candle.
 */
const CANDLE_BUFFER_MS = 2000;

export function lastCandleClose(interval: string, now: number): number {
  const ms = intervalToMs(interval);
  // Floor to interval boundary, then subtract one interval to get the *closed* candle
  // e.g. at 10:07:03, 5m interval → floor to 10:05:00 (that candle is closed)
  const boundary = Math.floor(now / ms) * ms;
  // If we're within the buffer window after boundary, the candle just closed
  // but we treat it as the previous one to ensure data is available
  if (now - boundary < CANDLE_BUFFER_MS) {
    return boundary - ms;
  }
  return boundary;
}
