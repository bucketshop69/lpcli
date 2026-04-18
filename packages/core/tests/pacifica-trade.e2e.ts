/**
 * Pacifica Trade E2E Tests
 *
 * Tests 1-3: Pure logic — lot size validation, no OWS/RPC needed.
 * Tests 4-5: Live Pacifica API — read-only market/price data.
 *
 * NO signing, NO wallet, NO order placement.
 *
 * Run with: pnpm --filter @lpcli/core test:e2e:trade
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  roundToLotSize,
  validateOrder,
  PacificaClient,
} from '../src/index.js';
import type { PacificaMarketInfo } from '../src/index.js';

// ---------------------------------------------------------------------------
// Mock market for pure logic tests
// ---------------------------------------------------------------------------

const MOCK_BTC_MARKET: PacificaMarketInfo = {
  symbol: 'BTC',
  tick_size: '0.1',
  lot_size: '0.0001',
  max_leverage: 40,
  min_order_size: '0.0001',
  max_order_size: '100',
  funding_rate: '0.0001',
  isolated_only: false,
};

const MOCK_SOL_MARKET: PacificaMarketInfo = {
  symbol: 'SOL',
  tick_size: '0.001',
  lot_size: '0.1',
  max_leverage: 20,
  min_order_size: '0.1',
  max_order_size: '100000',
  funding_rate: '0.0001',
  isolated_only: false,
};

// ---------------------------------------------------------------------------
// Pure logic tests
// ---------------------------------------------------------------------------

describe('roundToLotSize', { concurrency: false }, () => {

  test('1: rounds down to nearest lot size', () => {
    const eps = 1e-12;

    // BTC lot_size = 0.0001
    assert.ok(Math.abs(roundToLotSize(0.12345, MOCK_BTC_MARKET) - 0.1234) < eps);
    assert.ok(Math.abs(roundToLotSize(0.0001, MOCK_BTC_MARKET) - 0.0001) < eps);
    assert.ok(Math.abs(roundToLotSize(1.0, MOCK_BTC_MARKET) - 1.0) < eps);

    // SOL lot_size = 0.1
    assert.ok(Math.abs(roundToLotSize(5.75, MOCK_SOL_MARKET) - 5.7) < eps);
    assert.ok(Math.abs(roundToLotSize(0.15, MOCK_SOL_MARKET) - 0.1) < eps);
  });

  test('2: returns 0 for amounts below lot size', () => {
    assert.strictEqual(roundToLotSize(0.00005, MOCK_BTC_MARKET), 0);
    assert.strictEqual(roundToLotSize(0.05, MOCK_SOL_MARKET), 0);
  });

  test('3: handles exact multiples', () => {
    assert.strictEqual(roundToLotSize(0.001, MOCK_BTC_MARKET), 0.001);
    assert.strictEqual(roundToLotSize(10.0, MOCK_SOL_MARKET), 10.0);
  });

});

// ---------------------------------------------------------------------------
// Live API tests (read-only, no auth)
// ---------------------------------------------------------------------------

describe('validateOrder (live API)', { concurrency: false }, () => {

  test('4: validates a known symbol', async () => {
    const client = new PacificaClient();
    const market = await validateOrder('BTC', 0.001, client);

    assert.strictEqual(market.symbol, 'BTC');
    assert.ok(parseFloat(market.lot_size) > 0, 'lot_size should be positive');
    assert.ok(market.max_leverage > 0, 'max_leverage should be positive');
  });

  test('5: rejects unknown symbol', async () => {
    const client = new PacificaClient();

    await assert.rejects(
      () => validateOrder('DOESNOTEXIST999', 1, client),
      (err: Error) => {
        assert.ok(err.message.includes('Unknown symbol'), 'should mention unknown symbol');
        assert.ok(err.message.includes('Available'), 'should list available symbols');
        return true;
      },
    );
  });

});

console.log(`
Pacifica Trade E2E Tests
`);
