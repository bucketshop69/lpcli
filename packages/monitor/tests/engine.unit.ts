/**
 * Unit tests for @lpcli/monitor — store, types, and interval parsing.
 *
 * These tests are pure logic — no RPC, no wallet, no network.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { WatcherStore } from '../src/store.js';
import { intervalToMs, lastCandleClose, VALID_INTERVALS } from '../src/types.js';
import type { Condition, Action } from '../src/types.js';

// ============================================================================
// intervalToMs
// ============================================================================

describe('intervalToMs', () => {
  it('converts valid intervals', () => {
    assert.equal(intervalToMs('10s'), 10_000);
    assert.equal(intervalToMs('1m'), 60_000);
    assert.equal(intervalToMs('5m'), 300_000);
    assert.equal(intervalToMs('15m'), 900_000);
    assert.equal(intervalToMs('1h'), 3_600_000);
    assert.equal(intervalToMs('4h'), 14_400_000);
  });

  it('throws on invalid interval', () => {
    assert.throws(() => intervalToMs('2m'), /Invalid interval/);
    assert.throws(() => intervalToMs(''), /Invalid interval/);
  });

  it('VALID_INTERVALS has all keys', () => {
    assert.ok(VALID_INTERVALS.length >= 6);
    for (const iv of VALID_INTERVALS) {
      assert.doesNotThrow(() => intervalToMs(iv));
    }
  });
});

// ============================================================================
// WatcherStore
// ============================================================================

describe('WatcherStore', () => {
  // Use a fresh store for each test — operates on ~/.lpcli/watchers.json
  // We'll add and remove to avoid polluting state

  const conditions: Condition[] = [
    { type: 'rsi', symbol: 'SOL', timeframe: '15m', op: '>', value: 70 },
  ];
  const action: Action = { type: 'alert', message: 'test alert' };

  it('add creates a watcher with ID', () => {
    const store = new WatcherStore();
    const w = store.add({ name: 'test-watcher', conditions, action, interval: '1m', mode: 'one_shot' });
    assert.ok(w.id);
    assert.equal(w.name, 'test-watcher');
    assert.equal(w.enabled, true);
    assert.equal(w.triggerCount, 0);
    assert.equal(w.conditions.length, 1);

    // Cleanup
    store.remove(w.id);
  });

  it('list returns all watchers', () => {
    const store = new WatcherStore();
    const w1 = store.add({ name: 'w1', conditions, action, interval: '1m', mode: 'one_shot' });
    const w2 = store.add({ name: 'w2', conditions, action, interval: '5m', mode: 'repeating' });

    const list = store.list();
    const ids = list.map((w) => w.id);
    assert.ok(ids.includes(w1.id));
    assert.ok(ids.includes(w2.id));

    // Cleanup
    store.remove(w1.id);
    store.remove(w2.id);
  });

  it('update patches fields', () => {
    const store = new WatcherStore();
    const w = store.add({ name: 'updatable', conditions, action, interval: '1m', mode: 'one_shot' });

    store.update(w.id, { enabled: false, triggerCount: 3 });
    const updated = store.get(w.id);
    assert.equal(updated?.enabled, false);
    assert.equal(updated?.triggerCount, 3);

    // Cleanup
    store.remove(w.id);
  });

  it('remove deletes a watcher', () => {
    const store = new WatcherStore();
    const w = store.add({ name: 'removable', conditions, action, interval: '1m', mode: 'one_shot' });
    assert.ok(store.get(w.id));

    const removed = store.remove(w.id);
    assert.equal(removed, true);
    assert.equal(store.get(w.id), undefined);
  });

  it('remove returns false for unknown ID', () => {
    const store = new WatcherStore();
    assert.equal(store.remove('nonexistent'), false);
  });

  it('listEnabled filters disabled watchers', () => {
    const store = new WatcherStore();
    const w1 = store.add({ name: 'active', conditions, action, interval: '1m', mode: 'one_shot' });
    const w2 = store.add({ name: 'disabled', conditions, action, interval: '1m', mode: 'one_shot' });
    store.update(w2.id, { enabled: false });

    const enabled = store.listEnabled();
    const ids = enabled.map((w) => w.id);
    assert.ok(ids.includes(w1.id));
    assert.ok(!ids.includes(w2.id));

    // Cleanup
    store.remove(w1.id);
    store.remove(w2.id);
  });

  it('persists across instances', () => {
    const store1 = new WatcherStore();
    const w = store1.add({ name: 'persistent', conditions, action, interval: '1m', mode: 'one_shot' });

    // New instance reads from disk
    const store2 = new WatcherStore();
    const found = store2.get(w.id);
    assert.ok(found);
    assert.equal(found.name, 'persistent');

    // Cleanup
    store2.remove(w.id);
  });

  it('multi-condition watcher', () => {
    const store = new WatcherStore();
    const multiConds: Condition[] = [
      { type: 'rsi', symbol: 'SOL', timeframe: '15m', op: '<', value: 40 },
      { type: 'position_status', pool: 'abc123', status: 'out_of_range' },
    ];
    const closeAction: Action = { type: 'close_lp', pool: 'abc123' };

    const w = store.add({ name: 'rsi+oor close', conditions: multiConds, action: closeAction, interval: '1m', mode: 'one_shot' });
    assert.equal(w.conditions.length, 2);
    assert.equal(w.action.type, 'close_lp');

    // Cleanup
    store.remove(w.id);
  });
});

// ============================================================================
// lastCandleClose — candle boundary sync
// ============================================================================

describe('lastCandleClose', () => {
  it('5m candle — mid-candle returns previous close', () => {
    // 10:07:30 UTC → last 5m candle closed at 10:05:00
    const t = Date.UTC(2026, 0, 1, 10, 7, 30);
    const close = lastCandleClose('5m', t);
    assert.equal(close, Date.UTC(2026, 0, 1, 10, 5, 0));
  });

  it('5m candle — right at boundary returns that boundary', () => {
    // 10:10:03 UTC (3s past boundary, past 2s buffer) → 10:10:00
    const t = Date.UTC(2026, 0, 1, 10, 10, 3);
    const close = lastCandleClose('5m', t);
    assert.equal(close, Date.UTC(2026, 0, 1, 10, 10, 0));
  });

  it('5m candle — within buffer window returns previous boundary', () => {
    // 10:10:01 UTC (1s past boundary, within 2s buffer) → 10:05:00
    const t = Date.UTC(2026, 0, 1, 10, 10, 1);
    const close = lastCandleClose('5m', t);
    assert.equal(close, Date.UTC(2026, 0, 1, 10, 5, 0));
  });

  it('1h candle — aligns to hour boundary', () => {
    // 10:45:00 UTC → last 1h candle closed at 10:00:00
    const t = Date.UTC(2026, 0, 1, 10, 45, 0);
    const close = lastCandleClose('1h', t);
    assert.equal(close, Date.UTC(2026, 0, 1, 10, 0, 0));
  });

  it('1m candle — aligns to minute boundary', () => {
    // 10:07:35 UTC → last 1m candle closed at 10:07:00
    const t = Date.UTC(2026, 0, 1, 10, 7, 35);
    const close = lastCandleClose('1m', t);
    assert.equal(close, Date.UTC(2026, 0, 1, 10, 7, 0));
  });

  it('isDue logic — not due until new candle closes', () => {
    // Simulating: watcher checked at 10:05:30 (after 10:05 candle close)
    // Now it's 10:08:00 — same candle still open, not due
    const lastChecked = Date.UTC(2026, 0, 1, 10, 5, 30);
    const now = Date.UTC(2026, 0, 1, 10, 8, 0);
    const candleClose = lastCandleClose('5m', now);
    // candleClose = 10:05:00, lastChecked = 10:05:30 → candleClose < lastChecked → not due
    assert.ok(candleClose <= lastChecked, 'should not be due mid-candle');
  });

  it('isDue logic — due when new candle closes', () => {
    // Watcher checked at 10:05:30, now it's 10:10:05 — new candle closed
    const lastChecked = Date.UTC(2026, 0, 1, 10, 5, 30);
    const now = Date.UTC(2026, 0, 1, 10, 10, 5);
    const candleClose = lastCandleClose('5m', now);
    // candleClose = 10:10:00, lastChecked = 10:05:30 → candleClose > lastChecked → due
    assert.ok(candleClose > lastChecked, 'should be due after new candle close');
  });
});
