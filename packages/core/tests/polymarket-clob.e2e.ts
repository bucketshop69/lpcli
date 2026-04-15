/**
 * E2E test — Polymarket CLOB API (orderbook, pricing, market info)
 *
 * Routes through VPS relay when POLYMARKET_RELAY_URL is set (bypasses geo).
 * Falls back to direct clob.polymarket.com if no relay.
 *
 * Usage:
 *   node --import tsx --test tests/polymarket-clob.e2e.ts
 *
 * Required env:
 *   DOME_API_KEY           — for market resolution
 *   TARGET_MARKET_SLUG     — any active Polymarket slug
 *
 * Optional env:
 *   POLYMARKET_RELAY_URL   — VPS relay URL (recommended for geo-restricted regions)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMarket } from '../src/polymarket-dome.js';
import type { DomeConfig } from '../src/polymarket-dome.js';
import {
  getOrderBook,
  getOrderBookSummary,
  getMidpoint,
  getLastTradePrice,
  getClobMarketInfo,
  clobConfigFromEnv,
} from '../src/polymarket-clob.js';
import type { ClobConfig } from '../src/polymarket-clob.js';

const apiKey = process.env.DOME_API_KEY ?? '';
const slug = process.env.TARGET_MARKET_SLUG ?? '';

if (!apiKey || !slug) {
  console.error('Set DOME_API_KEY and TARGET_MARKET_SLUG');
  process.exit(1);
}

const domeConfig: DomeConfig = { apiKey };
const clobConfig: ClobConfig = clobConfigFromEnv();

const relayUrl = process.env.POLYMARKET_RELAY_URL;
console.log(`  CLOB routing: ${relayUrl ? `relay (${relayUrl})` : 'direct (clob.polymarket.com)'}`);

describe('Polymarket CLOB API', () => {
  let yesTokenId = '';
  let noTokenId = '';
  let conditionId = '';

  it('resolve market via Dome first', async () => {
    const result = await resolveMarket(slug, domeConfig);
    yesTokenId = result.yesTokenId;
    noTokenId = result.noTokenId;
    conditionId = result.conditionId;
    console.log(`  Resolved: ${result.market.title}`);
  });

  it('getOrderBook returns bids and asks', async () => {
    assert.ok(yesTokenId, 'No token ID');
    const book = await getOrderBook(yesTokenId, clobConfig);
    assert.ok(Array.isArray(book.bids), 'Missing bids');
    assert.ok(Array.isArray(book.asks), 'Missing asks');
    console.log(`  YES: ${book.bids.length} bids, ${book.asks.length} asks`);
  });

  it('getOrderBookSummary computes correct values', async () => {
    assert.ok(yesTokenId, 'No token ID');
    const summary = await getOrderBookSummary(yesTokenId, clobConfig);
    assert.ok(summary.bestBid > 0, `bestBid should be > 0: ${summary.bestBid}`);
    assert.ok(summary.bestAsk > 0, `bestAsk should be > 0: ${summary.bestAsk}`);
    assert.ok(summary.bestAsk > summary.bestBid, 'bestAsk should > bestBid');
    assert.ok(summary.midPrice > 0, 'midPrice should be > 0');
    assert.ok(summary.spread > 0, 'spread should be > 0');
    console.log(`  bid=${summary.bestBid.toFixed(3)} ask=${summary.bestAsk.toFixed(3)} mid=${summary.midPrice.toFixed(3)} spread=${(summary.spread * 100).toFixed(1)}c`);
    console.log(`  depth: ${summary.bidDepth.toFixed(0)} bid / ${summary.askDepth.toFixed(0)} ask shares`);
  });

  it('NO orderbook also works', async () => {
    assert.ok(noTokenId, 'No NO token ID');
    const summary = await getOrderBookSummary(noTokenId, clobConfig);
    assert.ok(summary.bestBid > 0, 'NO bestBid should be > 0');
    console.log(`  NO: bid=${summary.bestBid.toFixed(3)} ask=${summary.bestAsk.toFixed(3)} mid=${summary.midPrice.toFixed(3)}`);
  });

  it('YES + NO midpoints sum to ~1.0', async () => {
    assert.ok(yesTokenId && noTokenId, 'Missing tokens');
    const [yesMid, noMid] = await Promise.all([
      getMidpoint(yesTokenId, clobConfig),
      getMidpoint(noTokenId, clobConfig),
    ]);
    const sum = yesMid + noMid;
    assert.ok(sum > 0.95 && sum < 1.05, `Sum out of range: ${sum} (YES=${yesMid}, NO=${noMid})`);
    console.log(`  YES=${yesMid.toFixed(3)} + NO=${noMid.toFixed(3)} = ${sum.toFixed(4)}`);
  });

  it('getMidpoint returns valid price', async () => {
    assert.ok(yesTokenId, 'No token ID');
    const mid = await getMidpoint(yesTokenId, clobConfig);
    assert.ok(mid > 0 && mid < 1, `Midpoint out of range: ${mid}`);
    console.log(`  midpoint=${mid.toFixed(4)}`);
  });

  it('getLastTradePrice returns valid price', async () => {
    assert.ok(yesTokenId, 'No token ID');
    const price = await getLastTradePrice(yesTokenId, clobConfig);
    assert.ok(price > 0 && price < 1, `Last trade price out of range: ${price}`);
    console.log(`  lastTrade=${price.toFixed(4)}`);
  });

  it('getClobMarketInfo returns market metadata', async () => {
    assert.ok(conditionId, 'No condition ID');
    const info = await getClobMarketInfo(conditionId, clobConfig);
    assert.ok(info.condition_id, 'Missing condition_id');
    assert.ok(info.minimum_tick_size, 'Missing tick size');
    assert.ok(Array.isArray(info.tokens), 'Missing tokens');
    assert.ok(info.tokens.length >= 2, `Expected 2+ tokens, got ${info.tokens.length}`);
    console.log(`  tick=${info.minimum_tick_size} neg_risk=${info.neg_risk} active=${info.active}`);
  });

  it('CLOB tokens match Dome tokens', async () => {
    assert.ok(conditionId, 'No condition ID');
    const info = await getClobMarketInfo(conditionId, clobConfig);
    const clobIds = new Set(info.tokens.map(t => t.token_id));
    assert.ok(clobIds.has(yesTokenId), 'YES token not in CLOB tokens');
    assert.ok(clobIds.has(noTokenId), 'NO token not in CLOB tokens');
    console.log(`  Token IDs match between Dome and CLOB`);
  });

  it('rewards config available (if market has rewards)', async () => {
    assert.ok(conditionId, 'No condition ID');
    const info = await getClobMarketInfo(conditionId, clobConfig);
    if (info.rewards?.max_spread) {
      console.log(`  max_spread=${info.rewards.max_spread} min_size=${info.rewards.min_size}`);
      if (info.rewards.rates?.length) {
        console.log(`  daily_rate=${info.rewards.rates[0].rewards_daily_rate}`);
      }
    } else {
      console.log(`  No rewards on this market`);
    }
  });

  it('Dome price within CLOB bid-ask range', async () => {
    assert.ok(yesTokenId, 'No token ID');
    const { getDomePrice } = await import('../src/polymarket-dome.js');
    const [domeResult, summary] = await Promise.all([
      getDomePrice(yesTokenId, domeConfig),
      getOrderBookSummary(yesTokenId, clobConfig),
    ]);
    const margin = 0.05;
    const inRange = domeResult.price >= (summary.bestBid - margin) &&
                    domeResult.price <= (summary.bestAsk + margin);
    assert.ok(inRange, `Dome=${domeResult.price} outside CLOB [${summary.bestBid}, ${summary.bestAsk}]`);
    console.log(`  Dome=${domeResult.price.toFixed(3)} CLOB=[${summary.bestBid.toFixed(3)}, ${summary.bestAsk.toFixed(3)}] ✓`);
  });
});
