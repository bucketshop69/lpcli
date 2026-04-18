/**
 * Monitor E2E Tests
 *
 * Tests the full monitoring pipeline with live data:
 *   1. Store: create multi-condition watcher, persist, reload
 *   2. Evaluator: RSI condition against live Pacifica klines
 *   3. Evaluator: price condition against live Pacifica prices
 *   4. Evaluator: funding rate condition against live Pacifica prices
 *   5. Evaluator: multi-condition (RSI + price) — the real use case
 *   6. Engine: single tick with alert action — verifies full pipeline
 *   7. Real scenario: RSI < 40 on SOL 5m + position_status check
 *
 * NO wallet, NO signing, NO trade execution.
 * Read-only API calls + alert-only actions.
 *
 * Run with: node --import tsx --test tests/monitor.e2e.ts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PacificaClient, fetchRSI } from '@lpcli/core';
import { WatcherStore } from '../src/store.js';
import { evaluateCondition, evaluateAll } from '../src/evaluators.js';
import type { TickCache, EvalContext } from '../src/evaluators.js';
import { MonitorEngine } from '../src/engine.js';
import type {
  Condition,
  RsiCondition,
  PriceCondition,
  FundingRateCondition,
  PositionStatusCondition,
  WatcherEvent,
} from '../src/types.js';

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

const client = new PacificaClient();

// We can't create a full EvalContext without LPCLI/wallet, but for
// RSI/price/funding conditions the evaluator only needs the client.
// We pass a stub lpcli that will throw if Meteora conditions are hit.
const stubLpcli = {} as EvalContext['lpcli'];

function makeCtx(cache?: TickCache): EvalContext {
  return { client, lpcli: stubLpcli, cache: cache ?? {} };
}

// ---------------------------------------------------------------------------
// 1. Store: multi-condition watcher lifecycle
// ---------------------------------------------------------------------------

describe('Store: watcher lifecycle', () => {
  test('1: create RSI + position_status watcher, persist, reload, cleanup', () => {
    const store = new WatcherStore();

    const conditions: Condition[] = [
      { type: 'rsi', symbol: 'SOL', timeframe: '5m', op: '<', value: 40 },
      { type: 'position_status', pool: 'BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y', status: 'out_of_range' },
    ];

    const watcher = store.add({
      name: 'SOL RSI + OOR → close LP',
      conditions,
      action: { type: 'close_lp', pool: 'BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y' },
      interval: '1m',
      mode: 'one_shot',
    });

    assert.equal(watcher.conditions.length, 2);
    assert.equal(watcher.conditions[0].type, 'rsi');
    assert.equal(watcher.conditions[1].type, 'position_status');
    assert.equal(watcher.action.type, 'close_lp');
    assert.equal(watcher.mode, 'one_shot');
    assert.equal(watcher.enabled, true);

    // Reload from disk
    const store2 = new WatcherStore();
    const reloaded = store2.get(watcher.id);
    assert.ok(reloaded, 'watcher should survive reload');
    assert.equal(reloaded.name, 'SOL RSI + OOR → close LP');
    assert.equal(reloaded.conditions.length, 2);

    // Cleanup
    store2.remove(watcher.id);
  });
});

// ---------------------------------------------------------------------------
// 2. Evaluator: RSI condition (live)
// ---------------------------------------------------------------------------

describe('Evaluator: RSI condition (live API)', () => {
  test('2: fetch RSI for SOL 5m and evaluate against current value', async () => {
    // First get the actual RSI so we can write a condition that we KNOW the result of
    const rsiResult = await fetchRSI('SOL', '5m');
    assert.ok(rsiResult.rsi > 0 && rsiResult.rsi < 100, `RSI should be 0-100, got ${rsiResult.rsi}`);
    console.log(`    Live SOL 5m RSI: ${rsiResult.rsi.toFixed(1)}`);

    // Condition that SHOULD be true (rsi < 100 is always true)
    const alwaysTrue: RsiCondition = { type: 'rsi', symbol: 'SOL', timeframe: '5m', op: '<', value: 100 };
    const ctx = makeCtx();
    const result = await evaluateCondition(alwaysTrue, ctx);
    assert.equal(result, true, 'RSI < 100 should always be true');

    // Condition that SHOULD be false (rsi > 100 is always false)
    const alwaysFalse: RsiCondition = { type: 'rsi', symbol: 'SOL', timeframe: '5m', op: '>', value: 100 };
    // Reuse cache from previous eval
    const result2 = await evaluateCondition(alwaysFalse, ctx);
    assert.equal(result2, false, 'RSI > 100 should always be false');
  });
});

// ---------------------------------------------------------------------------
// 3. Evaluator: price condition (live)
// ---------------------------------------------------------------------------

describe('Evaluator: price condition (live API)', () => {
  test('3: fetch SOL price and evaluate threshold', async () => {
    const prices = await client.getPrices();
    const solPrice = prices.find((p) => p.symbol.toUpperCase() === 'SOL');
    assert.ok(solPrice, 'SOL should exist in Pacifica markets');
    const mark = parseFloat(solPrice.mark);
    console.log(`    Live SOL mark price: $${mark.toFixed(2)}`);

    // Price < 999999 should be true
    const cond: PriceCondition = { type: 'price', symbol: 'SOL', op: '<', value: 999999 };
    const ctx = makeCtx();
    const result = await evaluateCondition(cond, ctx);
    assert.equal(result, true);

    // Price > 999999 should be false
    const cond2: PriceCondition = { type: 'price', symbol: 'SOL', op: '>', value: 999999 };
    const result2 = await evaluateCondition(cond2, ctx);
    assert.equal(result2, false);
  });
});

// ---------------------------------------------------------------------------
// 4. Evaluator: funding rate condition (live)
// ---------------------------------------------------------------------------

describe('Evaluator: funding rate condition (live API)', () => {
  test('4: fetch SOL funding rate and evaluate', async () => {
    const prices = await client.getPrices();
    const solPrice = prices.find((p) => p.symbol.toUpperCase() === 'SOL');
    assert.ok(solPrice);
    const funding = parseFloat(solPrice.funding);
    console.log(`    Live SOL funding rate: ${(funding * 100).toFixed(4)}%`);

    // Funding < 1.0 (100%) should always be true in normal markets
    const cond: FundingRateCondition = { type: 'funding_rate', symbol: 'SOL', op: '<', value: 1.0 };
    const ctx = makeCtx();
    const result = await evaluateCondition(cond, ctx);
    assert.equal(result, true);
  });
});

// ---------------------------------------------------------------------------
// 5. Evaluator: multi-condition AND (RSI + price)
// ---------------------------------------------------------------------------

describe('Evaluator: multi-condition AND', () => {
  test('5: RSI < 100 AND price < 999999 — both true, evaluateAll returns true', async () => {
    const conditions: Condition[] = [
      { type: 'rsi', symbol: 'SOL', timeframe: '5m', op: '<', value: 100 },
      { type: 'price', symbol: 'SOL', op: '<', value: 999999 },
    ];
    const ctx = makeCtx();
    const result = await evaluateAll(conditions, ctx);
    assert.equal(result, true, 'both conditions should be true');
  });

  test('5b: RSI < 100 AND price > 999999 — one false, evaluateAll returns false', async () => {
    const conditions: Condition[] = [
      { type: 'rsi', symbol: 'SOL', timeframe: '5m', op: '<', value: 100 },
      { type: 'price', symbol: 'SOL', op: '>', value: 999999 },
    ];
    const ctx = makeCtx();
    const result = await evaluateAll(conditions, ctx);
    assert.equal(result, false, 'second condition is false, AND should be false');
  });
});

// ---------------------------------------------------------------------------
// 6. Engine: single tick with alert action
// ---------------------------------------------------------------------------

describe('Engine: alert-only tick', () => {
  test('6: create always-true watcher with alert, run one tick, verify event', async () => {
    const engine = new MonitorEngine({ tickMs: 60_000 }); // long tick so it doesn't auto-fire

    // Add a watcher that will always trigger (price < 999999)
    // Set lastCheckedAt far in the past so candle-sync logic sees it as due
    const watcher = engine.store.add({
      name: 'e2e-alert-test',
      conditions: [{ type: 'price', symbol: 'SOL', op: '<', value: 999999 }],
      action: { type: 'alert', message: 'e2e test fired' },
      interval: '10s',
      mode: 'one_shot',
    });
    engine.store.update(watcher.id, { lastCheckedAt: 0 });

    // Collect events
    const events: WatcherEvent[] = [];
    engine.on((e) => events.push(e));

    // DON'T call engine.start() — we just want one tick
    // Access the private tick method via the engine's store + evaluators
    // Instead, start and immediately stop after first trigger
    engine.start();

    // Wait for the first tick to complete (should be near-instant)
    await new Promise((resolve) => setTimeout(resolve, 3000));
    engine.stop();

    // Verify events
    const triggered = events.find((e) => e.type === 'triggered' && e.watcherId === watcher.id);
    const executed = events.find((e) => e.type === 'action_executed' && e.watcherId === watcher.id);

    assert.ok(triggered, 'watcher should have triggered');
    assert.ok(executed, 'alert action should have executed');
    assert.ok(executed!.detail!.includes('e2e test fired'), `detail should include message, got: ${executed!.detail}`);

    // One-shot should be disabled now
    const updated = engine.store.get(watcher.id);
    assert.equal(updated?.enabled, false, 'one_shot watcher should be disabled after trigger');
    assert.equal(updated?.triggerCount, 1);

    console.log(`    Engine fired alert: "${executed!.detail}"`);

    // Cleanup
    engine.store.remove(watcher.id);
  });
});

// ---------------------------------------------------------------------------
// 7. Real scenario: the Meteora close use case (evaluation only)
// ---------------------------------------------------------------------------

describe('Real scenario: RSI + position_status watcher', () => {
  test('7: simulate SOL RSI < 40 on 5m + pool out_of_range → close_lp', async () => {
    // This is the user's actual use case:
    //   IF rsi("SOL", "5m") < 40
    //   AND position in pool BGm1tav... is out_of_range
    //   THEN close_lp(pool)
    //
    // We can't test the position_status condition without a wallet,
    // but we CAN test the full pipeline by:
    //   1. Creating the watcher in the store
    //   2. Evaluating the RSI condition live
    //   3. Verifying the watcher structure is correct for the engine

    const store = new WatcherStore();
    const pool = 'BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y';

    const watcher = store.add({
      name: 'SOL RSI dip + OOR → close LP',
      conditions: [
        { type: 'rsi', symbol: 'SOL', timeframe: '5m', op: '<', value: 40 },
        { type: 'position_status', pool, status: 'out_of_range' },
      ],
      action: { type: 'close_lp', pool },
      interval: '1m',
      mode: 'one_shot',
    });

    // Verify structure
    assert.equal(watcher.conditions.length, 2);
    assert.equal(watcher.conditions[0].type, 'rsi');
    assert.equal((watcher.conditions[0] as RsiCondition).symbol, 'SOL');
    assert.equal((watcher.conditions[0] as RsiCondition).timeframe, '5m');
    assert.equal((watcher.conditions[0] as RsiCondition).op, '<');
    assert.equal((watcher.conditions[0] as RsiCondition).value, 40);
    assert.equal(watcher.conditions[1].type, 'position_status');
    assert.equal((watcher.conditions[1] as PositionStatusCondition).status, 'out_of_range');
    assert.equal(watcher.action.type, 'close_lp');

    // Evaluate RSI condition live — just to prove the evaluator works
    // with this exact condition shape
    const ctx = makeCtx();
    const rsiResult = await evaluateCondition(watcher.conditions[0], ctx);
    // We don't know if SOL RSI is actually < 40 right now, but we verify
    // the evaluator runs without error and returns a boolean
    assert.equal(typeof rsiResult, 'boolean');

    const rsiData = await fetchRSI('SOL', '5m');
    const expectedRsi = rsiData.rsi < 40;
    assert.equal(rsiResult, expectedRsi,
      `RSI condition should match: RSI=${rsiData.rsi.toFixed(1)}, condition=<40, expected=${expectedRsi}`);

    console.log(`    SOL 5m RSI: ${rsiData.rsi.toFixed(1)} — condition "< 40" is ${expectedRsi}`);
    console.log(`    Watcher would ${expectedRsi ? 'proceed to check position_status' : 'skip (RSI not met)'}`);
    console.log(`    Action: close_lp → ${pool.slice(0, 8)}...`);

    // Cleanup
    store.remove(watcher.id);
  });
});
