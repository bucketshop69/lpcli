// ============================================================================
// @lpcli/monitor — watcher engine for automated monitoring and trading
//
// Usage:
//   import { MonitorEngine, WatcherStore } from '@lpcli/monitor';
//   const engine = new MonitorEngine();
//   engine.store.add({ name: 'SOL RSI alert', conditions: [...], ... });
//   engine.on((event) => console.log(event));
//   engine.start();
// ============================================================================

export { MonitorEngine } from './engine.js';
export type { EngineOptions, EventHandler } from './engine.js';

export { WatcherStore } from './store.js';

export { evaluateCondition, evaluateAll } from './evaluators.js';
export type { TickCache, EvalContext } from './evaluators.js';

export { executeAction } from './executor.js';
export type { ExecutorContext } from './executor.js';

export type {
  Condition,
  RsiCondition,
  PriceCondition,
  FundingRateCondition,
  PositionStatusCondition,
  HasPositionCondition,
  Action,
  AlertAction,
  CloseLpAction,
  ClosePerpAction,
  TradeAction,
  WebhookAction,
  Watcher,
  WatcherEvent,
} from './types.js';

export { intervalToMs, lastCandleClose, VALID_INTERVALS } from './types.js';
