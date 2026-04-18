// ============================================================================
// Monitor Engine — @lpcli/monitor
//
// Single tick loop that evaluates all due watchers, executes actions,
// and emits events for CLI/TUI consumption.
// ============================================================================

import { LPCLI, PacificaClient } from '@lpcli/core';
import { WatcherStore } from './store.js';
import { evaluateAll } from './evaluators.js';
import type { TickCache } from './evaluators.js';
import { executeAction } from './executor.js';
import type { ExecutorContext } from './executor.js';
import { intervalToMs, lastCandleClose } from './types.js';
import type { Watcher, WatcherEvent } from './types.js';

// ============================================================================
// Types
// ============================================================================

export type EventHandler = (event: WatcherEvent) => void;

export interface EngineOptions {
  /** Base tick interval in ms. Default: 10_000 (10s). */
  tickMs?: number;
  /** Log file path. If set, events are appended here. */
  logFile?: string;
}

// ============================================================================
// Engine
// ============================================================================

export class MonitorEngine {
  readonly store: WatcherStore;
  private client: PacificaClient;
  private lpcli: LPCLI;
  private tickMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private handlers: EventHandler[] = [];
  private logFile: string | undefined;
  private ticking = false;

  constructor(options?: EngineOptions) {
    this.store = new WatcherStore();
    this.client = new PacificaClient();
    this.lpcli = new LPCLI();
    this.tickMs = options?.tickMs ?? 10_000;
    this.logFile = options?.logFile;
  }

  /** Subscribe to watcher events (for TUI/CLI). */
  on(handler: EventHandler): void {
    this.handlers.push(handler);
  }

  /** Remove an event handler. */
  off(handler: EventHandler): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  private emit(event: WatcherEvent): void {
    for (const handler of this.handlers) {
      try { handler(event); } catch { /* don't let handler errors kill the engine */ }
    }
    if (this.logFile) {
      this.appendLog(event);
    }
  }

  private appendLog(event: WatcherEvent): void {
    try {
      const { appendFileSync } = require('node:fs') as typeof import('node:fs');
      const line = `[${new Date(event.timestamp).toISOString()}] ${event.type} | ${event.watcherName} | ${event.detail ?? ''}\n`;
      appendFileSync(this.logFile!, line);
    } catch { /* logging failure is non-fatal */ }
  }

  /** Start the tick loop. */
  start(): void {
    if (this.timer) return;
    this.emit({
      type: 'checked',
      watcherId: '_engine',
      watcherName: '_engine',
      timestamp: Date.now(),
      detail: `Monitor started — tick every ${this.tickMs / 1000}s, ${this.store.listEnabled().length} active watcher(s)`,
    });

    // Run first tick immediately
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.tickMs);
  }

  /** Stop the tick loop. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Whether the engine is currently running. */
  get running(): boolean {
    return this.timer !== null;
  }

  // -------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------

  private async tick(): Promise<void> {
    // Prevent overlapping ticks (if a tick takes longer than tickMs)
    if (this.ticking) return;
    this.ticking = true;

    try {
      const watchers = this.store.listEnabled();
      if (watchers.length === 0) return;

      const now = Date.now();
      const due = watchers.filter((w) => this.isDue(w, now));
      if (due.length === 0) return;

      // Fresh cache per tick — shared across all evaluators
      const cache: TickCache = {};

      const evalCtx = { client: this.client, lpcli: this.lpcli, cache };
      const execCtx: ExecutorContext = { client: this.client, lpcli: this.lpcli };

      for (const watcher of due) {
        await this.processWatcher(watcher, evalCtx, execCtx, now);
      }
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Check if a watcher is due for evaluation.
   *
   * Syncs with candle close boundaries so we only evaluate after a candle
   * has finalized. For example, a 5m watcher only fires after :00, :05, :10, etc.
   * This prevents evaluating RSI on incomplete candles.
   */
  private isDue(watcher: Watcher, now: number): boolean {
    const candleClose = lastCandleClose(watcher.interval, now);
    const lastChecked = watcher.lastCheckedAt ?? 0;
    // Due if a new candle has closed since we last checked
    return candleClose > lastChecked;
  }

  private async processWatcher(
    watcher: Watcher,
    evalCtx: { client: PacificaClient; lpcli: LPCLI; cache: TickCache },
    execCtx: ExecutorContext,
    now: number,
  ): Promise<void> {
    try {
      // Mark as checked
      this.store.update(watcher.id, { lastCheckedAt: now, lastError: undefined });

      // Evaluate all conditions
      const triggered = await evaluateAll(watcher.conditions, evalCtx);

      this.emit({
        type: 'checked',
        watcherId: watcher.id,
        watcherName: watcher.name,
        timestamp: now,
        detail: triggered ? 'conditions met' : 'conditions not met',
      });

      if (!triggered) return;

      // Cooldown check for repeating watchers
      if (watcher.mode === 'repeating' && watcher.lastTriggeredAt) {
        const cooldown = (watcher.cooldownSeconds ?? 60) * 1000;
        if (now - watcher.lastTriggeredAt < cooldown) return;
      }

      // Trigger!
      this.emit({
        type: 'triggered',
        watcherId: watcher.id,
        watcherName: watcher.name,
        timestamp: now,
      });

      // Execute action
      try {
        const event = await executeAction(watcher.action, watcher.id, watcher.name, execCtx);
        this.emit(event);
      } catch (err: unknown) {
        this.emit({
          type: 'action_failed',
          watcherId: watcher.id,
          watcherName: watcher.name,
          timestamp: now,
          detail: err instanceof Error ? err.message : String(err),
        });
        this.store.update(watcher.id, {
          lastError: err instanceof Error ? err.message : String(err),
        });
        return; // Don't update trigger state on failed action
      }

      // Update trigger state
      this.store.update(watcher.id, {
        lastTriggeredAt: now,
        triggerCount: watcher.triggerCount + 1,
      });

      // Disable one-shot watchers
      if (watcher.mode === 'one_shot') {
        this.store.update(watcher.id, { enabled: false });
      }
    } catch (err: unknown) {
      // Evaluation error — log but don't kill other watchers
      const msg = err instanceof Error ? err.message : String(err);
      this.emit({
        type: 'error',
        watcherId: watcher.id,
        watcherName: watcher.name,
        timestamp: now,
        detail: msg,
      });
      this.store.update(watcher.id, { lastError: msg });
    }
  }
}
