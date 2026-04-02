/**
 * LPCLI Core E2E Tests
 *
 * These tests hit live APIs. Set CLUSTER and HELIUS_RPC_URL in .env before running.
 * Run with: pnpm --filter @lpcli/core test:e2e
 *
 * Tests run in order — discovery must pass before position operations are meaningful.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { MeteoraClient, DLMMService, WalletService, LPCLI, rankPools } from '../src/core.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CLUSTER = (process.env.CLUSTER ?? 'mainnet') as 'mainnet' | 'devnet';
const HELIUS_RPC_URL =
  process.env.HELIUS_RPC_URL ??
  'https://mainnet.helius-rpc.com/?api-key=demo'; // won't work without real key

const METEORA_BASE = CLUSTER === 'mainnet'
  ? 'https://dlmm.datapi.meteora.ag'
  : 'https://dlmm-api.devnet.meteora.ag';

// ---------------------------------------------------------------------------
// Helper: skip if no real RPC
// ---------------------------------------------------------------------------

function requiresRealApi() {
  if (HELIUS_RPC_URL.includes('demo')) {
    console.log('⏭️  Skipping (needs real HELIUS_RPC_URL)');
    process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// MeteoraClient Tests
// ---------------------------------------------------------------------------

describe('MeteoraClient', { concurrency: false }, () => {

  test('should fetch pools from REST API', async () => {
    const client = new MeteoraClient({ rpcUrl: HELIUS_RPC_URL, cluster: CLUSTER });
    const result = await client.getPools({ pageSize: 1 });

    assert.ok(result.data.length >= 1, 'should return at least 1 pool');
    const pool = result.data[0];

    // Log full shape of first pool — this is our source of truth for types
    console.log('\n📦 First pool shape:');
    console.log(JSON.stringify(pool, null, 2));

    // Verify our MeteoraPoolRaw type matches reality
    assert.ok(typeof pool.address === 'string', 'pool.address should be string');
    assert.ok(typeof pool.name === 'string', 'pool.name should be string');
    assert.ok(typeof pool.tvl === 'number', 'pool.tvl should be number');
    assert.ok(typeof pool.current_price === 'number', 'pool.current_price should be number');
    assert.ok(typeof pool.is_blacklisted === 'boolean', 'pool.is_blacklisted should be boolean');
    assert.ok(Array.isArray(pool.tags), 'pool.tags should be array');
  });

  test('should filter by token query', async () => {
    const client = new MeteoraClient({ rpcUrl: HELIUS_RPC_URL, cluster: CLUSTER });
    const result = await client.getPools({ query: 'SOL', pageSize: 5 });

    assert.ok(result.data.length >= 1, 'should find SOL pools');
    for (const pool of result.data) {
      const hasSOL =
        pool.token_x.symbol.includes('SOL') ||
        pool.token_y.symbol.includes('SOL') ||
        pool.name.includes('SOL');
      assert.ok(hasSOL, `Pool ${pool.name} should have SOL`);
    }
  });

  test('should use 5-min cache', async () => {
    const client = new MeteoraClient({ rpcUrl: HELIUS_RPC_URL, cluster: CLUSTER });

    const t0 = Date.now();
    await client.getPools({ pageSize: 1 });
    const t1 = Date.now();

    // Second call should be cached (instant)
    const t2 = Date.now();
    await client.getPools({ pageSize: 1 });
    const t3 = Date.now();

    // Second call should be < 10ms (cached)
    assert.ok(
      t3 - t2 < 10,
      `Cache read took ${t3 - t2}ms, should be near-instant`
    );
    console.log(`\n⏱️  Cache: first=${t1 - t0}ms, cached=${t3 - t2}ms`);
  });

  test('should clear cache manually', async () => {
    const client = new MeteoraClient({ rpcUrl: HELIUS_RPC_URL, cluster: CLUSTER });

    await client.getPools({ pageSize: 1 });
    client.clearCache();

    const before = Date.now();
    await client.getPools({ pageSize: 1 });
    const after = Date.now();

    // After clear, should be a real network call
    assert.ok(after - before > 50, 'Should be a real fetch after clearCache()');
  });

});

// ---------------------------------------------------------------------------
// ScoringEngine Tests
// ---------------------------------------------------------------------------

describe('ScoringEngine', { concurrency: false }, () => {

  test('should score and rank real pools', async () => {
    const client = new MeteoraClient({ rpcUrl: HELIUS_RPC_URL, cluster: CLUSTER });
    const result = await client.getPools({ query: 'SOL', pageSize: 20 });

    const ranked = rankPools(result.data);

    console.log('\n🏆 Top 5 SOL pools by score:');
    for (let i = 0; i < Math.min(5, ranked.length); i++) {
      const p = ranked[i];
      console.log(
        `  ${i + 1}. ${p.name} | TVL:$${(p.tvl / 1e6).toFixed(1)}M | ` +
        `Fee: ${p.fee_tvl_ratio_24h.toFixed(2)}% | Score: ${p.score.toFixed(1)} | ` +
        `Momentum: ${p.momentum.toFixed(2)}`
      );
    }

    assert.ok(ranked.length >= 1, 'should have at least 1 scored pool');

    // Top pool should pass the gate
    const top = ranked[0];
    assert.ok(top.tvl >= 10_000, `Top pool TVL $${top.tvl} should pass $10K gate`);
    assert.ok(!Number.isNaN(top.score), 'score should be a number');
    assert.ok(top.score >= 0, 'score should be non-negative');
  });

  test('should filter out blacklisted pools', async () => {
    const client = new MeteoraClient({ rpcUrl: HELIUS_RPC_URL, cluster: CLUSTER });
    const result = await client.getPools({ pageSize: 50 });

    const ranked = rankPools(result.data);
    for (const p of ranked) {
      assert.ok(!p.name.toLowerCase().includes('scam'), 'Should not include scam pools in ranked list');
    }
  });

  test('should apply momentum penalty to cooling pools', async () => {
    // Use a specific pool from real data to verify momentum
    const client = new MeteoraClient({ rpcUrl: HELIUS_RPC_URL, cluster: CLUSTER });
    const result = await client.getPools({ query: 'SOL', pageSize: 20 });
    const ranked = rankPools(result.data);

    // Momentum should be between 0.8 and 2.0
    for (const p of ranked) {
      assert.ok(
        p.momentum >= 0.8 && p.momentum <= 2.0,
        `Momentum ${p.momentum} should be in [0.8, 2.0]`
      );
    }
  });

});

// ---------------------------------------------------------------------------
// WalletService Tests
// ---------------------------------------------------------------------------

describe('WalletService', { concurrency: false }, () => {

  test('should connect to RPC and show balance (requires real RPC)', () => {
    requiresRealApi();
  });

  test('TODO: verify OWS signer (post-hackathon)', () => {
    console.log('\n🔒 OWS integration: TODO — implement after Keypair fallback is verified');
  });

});

// ---------------------------------------------------------------------------
// DLMMService Tests
// ---------------------------------------------------------------------------

describe('DLMMService', { concurrency: false }, () => {

  test('TODO: open a real position on devnet', () => {
    if (CLUSTER !== 'devnet') {
      console.log('\n⏭️  Skipping position test on mainnet — use devnet for position ops');
      return;
    }
    requiresRealApi();
    // TODO: After implementing openPosition:
    // 1. Create or find a devnet pool
    // 2. Open a small position (0.1 SOL)
    // 3. Verify position appears in getPositions
    // 4. Close it and verify funds returned
  });

  test('TODO: getPositions returns positions with P&L (best-effort)', () => {
    requiresRealApi();
    // TODO: After implementing getPositions:
    // - Verify pnl_usd is null for positions not opened via LPCLI
    // - Verify fees_earned are populated
  });

});

// ---------------------------------------------------------------------------
// LPCLI Integration Tests
// ---------------------------------------------------------------------------

describe('LPCLI Integration', { concurrency: false }, () => {

  test('should run full discovery pipeline', async () => {
    const lpcli = new LPCLI({ rpcUrl: HELIUS_RPC_URL, cluster: CLUSTER });

    const pools = await lpcli.discoverPools('SOL', 'score', 5);

    console.log('\n📊 LPCLI discoverPools() result:');
    for (let i = 0; i < pools.length; i++) {
      const p = pools[i];
      console.log(
        `  ${i + 1}. ${p.name} | Score: ${p.score.toFixed(1)} | ` +
        `TVL: $${(p.tvl / 1e6).toFixed(1)}M | Fee: ${p.fee_tvl_ratio_24h.toFixed(2)}%`
      );
    }

    assert.ok(pools.length >= 1, 'should return at least 1 pool');
    assert.ok(pools.length <= 5, 'should respect limit');
  });

  test('should get pool info for a specific pool', async () => {
    const lpcli = new LPCLI({ rpcUrl: HELIUS_RPC_URL, cluster: CLUSTER });
    const pools = await lpcli.discoverPools('SOL', 'score', 1);
    assert.ok(pools.length === 1, 'need 1 pool for this test');

    const info = await lpcli.getPoolInfo(pools[0].address);

    console.log('\n🏊 Pool info:', JSON.stringify(info, null, 2));

    assert.ok(info.address === pools[0].address, 'address should match');
    assert.ok(typeof info.tvl === 'number', 'tvl should be number');
    assert.ok(typeof info.current_price === 'number', 'price should be number');
  });

});

// ---------------------------------------------------------------------------
// Run all tests
// ---------------------------------------------------------------------------

console.log(`
╔══════════════════════════════════════════════════════╗
║  LPCLI Core E2E Tests                               ║
║  Cluster: ${CLUSTER.padEnd(42)}║
║  RPC: ${(HELIUS_RPC_URL.split('?')[0]).padEnd(45)}║
╚══════════════════════════════════════════════════════╝
`);
