/**
 * E2E test — Polymarket Dome API (market discovery + pricing)
 *
 * Usage:
 *   node --import tsx --test tests/polymarket-dome.e2e.ts
 *
 * Required env:
 *   DOME_API_KEY           — from dashboard.domeapi.io
 *   TARGET_MARKET_SLUG     — any active Polymarket slug
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchMarkets,
  getMarketBySlug,
  getDomePrice,
  resolveMarket,
} from '../src/polymarket-dome.js';
import type { DomeConfig } from '../src/polymarket-dome.js';

const apiKey = process.env.DOME_API_KEY ?? '';
const slug = process.env.TARGET_MARKET_SLUG ?? '';

if (!apiKey || !slug) {
  console.error('Set DOME_API_KEY and TARGET_MARKET_SLUG');
  process.exit(1);
}

const config: DomeConfig = { apiKey };

describe('Polymarket Dome API', () => {
  let yesTokenId = '';
  let noTokenId = '';

  it('searchMarkets by slug returns results', async () => {
    const markets = await searchMarkets({ market_slug: slug, limit: 1 }, config);
    assert.ok(markets.length > 0, `No market found for slug: ${slug}`);
    assert.ok(markets[0].condition_id, 'Missing condition_id');
    assert.ok(markets[0].side_a?.id, 'Missing side_a token ID');
    yesTokenId = markets[0].side_a.id;
    noTokenId = markets[0].side_b?.id ?? '';
    console.log(`  Found: "${markets[0].title}" | condition=${markets[0].condition_id.slice(0, 16)}...`);
  });

  it('getMarketBySlug returns single market', async () => {
    const market = await getMarketBySlug(slug, config);
    assert.ok(market, 'No market returned');
    assert.equal(market.market_slug, slug);
    console.log(`  status=${market.status} tags=${(market.tags || []).join(',')}`);
  });

  it('searchMarkets by tag returns results', async () => {
    const markets = await searchMarkets({ tags: 'politics', status: 'open', limit: 5 }, config);
    assert.ok(markets.length > 0, 'No politics markets found');
    console.log(`  Found ${markets.length} politics markets`);
  });

  it('getDomePrice returns valid YES price', async () => {
    assert.ok(yesTokenId, 'No YES token ID from previous test');
    const result = await getDomePrice(yesTokenId, config);
    assert.ok(result.price >= 0 && result.price <= 1, `Price out of range: ${result.price}`);
    console.log(`  YES = ${(result.price * 100).toFixed(1)}%`);
  });

  it('getDomePrice returns valid NO price', async () => {
    assert.ok(noTokenId, 'No NO token ID');
    const result = await getDomePrice(noTokenId, config);
    assert.ok(result.price >= 0 && result.price <= 1, `Price out of range: ${result.price}`);
    console.log(`  NO = ${(result.price * 100).toFixed(1)}%`);
  });

  it('YES + NO prices sum to ~1.0', async () => {
    assert.ok(yesTokenId && noTokenId, 'Missing token IDs');
    const [yes, no] = await Promise.all([
      getDomePrice(yesTokenId, config),
      getDomePrice(noTokenId, config),
    ]);
    const sum = yes.price + no.price;
    assert.ok(sum > 0.95 && sum < 1.05, `Sum out of range: ${sum}`);
    console.log(`  ${yes.price.toFixed(3)} + ${no.price.toFixed(3)} = ${sum.toFixed(4)}`);
  });

  it('resolveMarket returns full market info', async () => {
    const result = await resolveMarket(slug, config);
    assert.ok(result.conditionId, 'Missing conditionId');
    assert.ok(result.yesTokenId, 'Missing yesTokenId');
    assert.ok(result.noTokenId, 'Missing noTokenId');
    assert.ok(result.market.title, 'Missing title');
    console.log(`  Resolved: ${result.market.title}`);
    console.log(`  YES=${result.yesTokenId.slice(0, 20)}... NO=${result.noTokenId.slice(0, 20)}...`);
  });
});
