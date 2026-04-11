/**
 * Pacifica Indicators E2E Tests
 *
 * Tests 1-3: Pure logic — RSI calculation, no network.
 * Tests 4-5: Live Pacifica API — fetchRSI.
 *
 * NO signing, NO wallet.
 *
 * Run with: pnpm --filter @lpcli/core test:e2e:indicators
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRSI, fetchRSI } from '../src/index.js';

describe('calculateRSI', { concurrency: false }, () => {

  test('1: returns null with insufficient data', () => {
    assert.strictEqual(calculateRSI([100, 101, 102], 14), null);
    assert.strictEqual(calculateRSI([], 14), null);
  });

  test('2: returns 100 for all-up prices', () => {
    // 16 prices, all increasing by 1 => 15 changes, all positive
    const prices = Array.from({ length: 16 }, (_, i) => 100 + i);
    const rsi = calculateRSI(prices, 14);
    assert.ok(rsi !== null);
    assert.strictEqual(rsi, 100);
  });

  test('3: returns ~50 for alternating up/down', () => {
    // Alternating +1/-1 changes => equal avg gain and avg loss
    const prices: number[] = [100];
    for (let i = 1; i <= 30; i++) {
      prices.push(prices[i - 1] + (i % 2 === 1 ? 1 : -1));
    }
    const rsi = calculateRSI(prices, 14);
    assert.ok(rsi !== null);
    assert.ok(rsi > 45 && rsi < 55, `RSI should be ~50, got ${rsi}`);
  });

});

describe('fetchRSI (live API)', { concurrency: false }, () => {

  test('4: fetches RSI for BTC 15m', async () => {
    const result = await fetchRSI('BTC', '15m');

    assert.strictEqual(result.symbol, 'BTC');
    assert.strictEqual(result.interval, '15m');
    assert.ok(result.rsi >= 0 && result.rsi <= 100, `RSI out of range: ${result.rsi}`);
    assert.ok(result.price > 0, 'price should be positive');
    assert.ok(['overbought', 'oversold', 'neutral'].includes(result.zone));
    assert.ok(result.candleCount >= 15, 'should have enough candles');
  });

  test('5: rejects invalid symbol', async () => {
    await assert.rejects(
      () => fetchRSI('DOESNOTEXIST999', '15m'),
    );
  });

});

console.log(`
Pacifica Indicators E2E Tests
`);
