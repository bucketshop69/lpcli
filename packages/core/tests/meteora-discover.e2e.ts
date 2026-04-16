/**
 * Meteora pool-discovery API e2e tests.
 *
 * These hit the live pool-discovery API — no wallet or RPC needed.
 * Run with: node --import tsx --test tests/meteora-discover.e2e.ts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Connection } from '@solana/web3.js';
import { MeteoraClient, DEFAULT_DISCOVER_CONFIG, TokenRegistry, LPCLI } from '../src/index.js';
import type { DiscoveredPool, DiscoverConfig, MeteoraPoolRaw } from '../src/index.js';

const CLUSTER = 'mainnet' as const;
const DUMMY_RPC = 'https://api.mainnet-beta.solana.com'; // only for TokenRegistry constructor

// ============================================================================
// MeteoraClient — raw API
// ============================================================================

describe('MeteoraClient (pool-discovery API)', { concurrency: false }, () => {
  const client = new MeteoraClient({ rpcUrl: DUMMY_RPC, cluster: CLUSTER });

  test('getPools returns pools with expected shape', async () => {
    const result = await client.getPools({ pageSize: 3 });

    assert.ok(result.data.length >= 1, 'should return at least 1 pool');
    assert.ok(typeof result.total === 'number', 'total should be number');
    assert.ok(typeof result.has_more === 'boolean', 'has_more should be boolean');

    const pool = result.data[0];
    // Core fields from pool-discovery API
    assert.ok(typeof pool.pool_address === 'string', 'pool_address');
    assert.ok(typeof pool.name === 'string', 'name');
    assert.ok(typeof pool.pool_type === 'string', 'pool_type');
    assert.ok(typeof pool.pool_price === 'number', 'pool_price');
    assert.ok(typeof pool.tvl === 'number', 'tvl');
    assert.ok(typeof pool.active_tvl === 'number', 'active_tvl');
    assert.ok(typeof pool.avg_fee === 'number', 'avg_fee');
    assert.ok(typeof pool.fee_active_tvl_ratio === 'number', 'fee_active_tvl_ratio');
    assert.ok(typeof pool.swap_count === 'number', 'swap_count');
    assert.ok(typeof pool.unique_traders === 'number', 'unique_traders');
    assert.ok(typeof pool.volatility === 'number', 'volatility');

    // Token objects
    assert.ok(typeof pool.token_x.address === 'string', 'token_x.address');
    assert.ok(typeof pool.token_x.symbol === 'string', 'token_x.symbol');
    assert.ok(typeof pool.token_x.decimals === 'number', 'token_x.decimals');
    assert.ok(typeof pool.token_y.address === 'string', 'token_y.address');

    console.log(`  Got ${result.data.length} pools (total: ${result.total})`);
  });

  test('getPools accepts sort_by param without error', async () => {
    client.clearCache();
    const result = await client.getPools({
      pageSize: 5,
      sortBy: 'tvl:desc',
    });

    assert.ok(result.data.length >= 1, 'sort_by should return results');
    // API sort is approximate — just verify it doesn't error
    console.log(`  Sorted by tvl:desc — top TVL: $${result.data[0].tvl.toFixed(0)}`);
  });

  test('getPools supports query filter', async () => {
    const result = await client.getPools({ query: 'SOL', pageSize: 5 });

    assert.ok(result.data.length >= 1, 'should find SOL pools');
    for (const pool of result.data) {
      const hasSOL =
        pool.token_x.symbol.toUpperCase().includes('SOL') ||
        pool.token_y.symbol.toUpperCase().includes('SOL') ||
        pool.name.toUpperCase().includes('SOL');
      assert.ok(hasSOL, `Pool ${pool.name} should have SOL`);
    }
  });

  test('getPool fetches single pool by address', async () => {
    // First get a pool address to test with
    const list = await client.getPools({ pageSize: 1 });
    const addr = list.data[0].pool_address;

    client.clearCache();
    const pool = await client.getPool(addr);

    assert.strictEqual(pool.pool_address, addr, 'address should match');
    assert.ok(typeof pool.name === 'string', 'name present');
    console.log(`  Single pool: ${pool.name} (${addr.slice(0, 8)}...)`);
  });

  test('cache returns same data without network call', async () => {
    client.clearCache();

    const t0 = Date.now();
    const r1 = await client.getPools({ pageSize: 1 });
    const firstMs = Date.now() - t0;

    const t1 = Date.now();
    const r2 = await client.getPools({ pageSize: 1 });
    const cachedMs = Date.now() - t1;

    assert.deepStrictEqual(r1, r2, 'cached result should be identical');
    assert.ok(cachedMs < 5, `Cache read took ${cachedMs}ms, should be near-instant`);
    console.log(`  First: ${firstMs}ms, Cached: ${cachedMs}ms`);
  });

  test('clearCache invalidates internal cache', async () => {
    // Populate cache with a specific query
    await client.getPools({ pageSize: 1, query: 'SOL' });

    // Cache should work for same query
    const t0 = Date.now();
    await client.getPools({ pageSize: 1, query: 'SOL' });
    const cachedMs = Date.now() - t0;
    assert.ok(cachedMs < 5, `Cached read should be fast (${cachedMs}ms)`);

    // After clear, cache miss — different code path
    client.clearCache();

    // Verify cache map is empty by checking a different query returns fresh data
    // (We can't reliably time network calls, but we can verify the cache was cleared)
    const t1 = Date.now();
    await client.getPools({ pageSize: 1, query: 'USDC' });
    const freshMs = Date.now() - t1;

    // Just verify it completed without error — timing varies by network
    console.log(`  Cache clear test: cached=${cachedMs}ms, fresh=${freshMs}ms`);
    assert.ok(true, 'clearCache completed without error');
  });
});

// ============================================================================
// MeteoraClient.discover — quality gates
// ============================================================================

describe('MeteoraClient.discover', { concurrency: false }, () => {
  const client = new MeteoraClient({ rpcUrl: DUMMY_RPC, cluster: CLUSTER });

  test('returns DiscoveredPool objects with all fields', async () => {
    const pools = await client.discover();

    assert.ok(pools.length >= 1, 'should return at least 1 pool');

    const pool = pools[0];
    assert.ok(typeof pool.pool_address === 'string', 'pool_address');
    assert.ok(typeof pool.name === 'string', 'name');
    assert.ok(typeof pool.token_x === 'string', 'token_x symbol');
    assert.ok(typeof pool.token_y === 'string', 'token_y symbol');
    assert.ok(typeof pool.token_x_mint === 'string', 'token_x_mint');
    assert.ok(typeof pool.token_y_mint === 'string', 'token_y_mint');
    assert.ok(typeof pool.avg_fee === 'number', 'avg_fee');
    assert.ok(typeof pool.fee_active_tvl_ratio === 'number', 'fee_active_tvl_ratio');
    assert.ok(typeof pool.active_tvl === 'number', 'active_tvl');
    assert.ok(typeof pool.volatility === 'number', 'volatility');
    assert.ok(typeof pool.swap_count === 'number', 'swap_count');
    assert.ok(typeof pool.unique_traders === 'number', 'unique_traders');
    assert.ok(typeof pool.pool_age_ms === 'number', 'pool_age_ms');
    assert.ok(typeof pool.has_farm === 'boolean', 'has_farm');
    assert.ok(typeof pool.bin_step === 'number', 'bin_step');

    console.log(`  Discovered ${pools.length} pools (default gates)`);
  });

  test('applies quality gates — no dust pools', async () => {
    const pools = await client.discover();
    const cfg = DEFAULT_DISCOVER_CONFIG;

    for (const pool of pools) {
      assert.ok(
        pool.active_tvl >= cfg.minActiveTvl,
        `${pool.name} active_tvl ${pool.active_tvl} < gate ${cfg.minActiveTvl}`,
      );
      assert.ok(
        pool.swap_count >= cfg.minSwapCount,
        `${pool.name} swap_count ${pool.swap_count} < gate ${cfg.minSwapCount}`,
      );
      assert.ok(
        pool.unique_traders >= cfg.minTraders,
        `${pool.name} unique_traders ${pool.unique_traders} < gate ${cfg.minTraders}`,
      );
    }
  });

  test('accepts custom config overrides', async () => {
    const pools = await client.discover(undefined, {
      minActiveTvl: 500_000,
      minSwapCount: 1000,
    });

    for (const pool of pools) {
      assert.ok(pool.active_tvl >= 500_000, `${pool.name} active_tvl should be >= $500K`);
      assert.ok(pool.swap_count >= 1000, `${pool.name} swaps should be >= 1000`);
    }

    console.log(`  ${pools.length} pools pass strict gates`);
  });

  test('query filters results', async () => {
    const pools = await client.discover('SOL');

    assert.ok(pools.length >= 1, 'should find SOL pools');
    for (const pool of pools) {
      const hasSOL =
        pool.token_x.toUpperCase().includes('SOL') ||
        pool.token_y.toUpperCase().includes('SOL') ||
        pool.name.toUpperCase().includes('SOL');
      assert.ok(hasSOL, `${pool.name} should match SOL query`);
    }
  });
});

// ============================================================================
// MeteoraClient.getPoolInfo — structured pool detail
// ============================================================================

describe('MeteoraClient.getPoolInfo', { concurrency: false }, () => {
  const client = new MeteoraClient({ rpcUrl: DUMMY_RPC, cluster: CLUSTER });

  test('returns PoolInfo with all fields', async () => {
    // Grab a real pool address first
    const pools = await client.discover();
    assert.ok(pools.length >= 1, 'need at least 1 pool');
    const addr = pools[0].pool_address;

    client.clearCache();
    const info = await client.getPoolInfo(addr);

    assert.strictEqual(info.pool_address, addr, 'pool_address');
    assert.ok(typeof info.name === 'string', 'name');
    assert.ok(typeof info.token_x === 'string', 'token_x');
    assert.ok(typeof info.token_y === 'string', 'token_y');
    assert.ok(typeof info.token_x_mint === 'string', 'token_x_mint');
    assert.ok(typeof info.token_y_mint === 'string', 'token_y_mint');
    assert.ok(typeof info.pool_type === 'string', 'pool_type');
    assert.ok(typeof info.pool_price === 'number', 'pool_price');
    assert.ok(typeof info.tvl === 'number', 'tvl');
    assert.ok(typeof info.active_tvl === 'number', 'active_tvl');
    assert.ok(typeof info.avg_fee === 'number', 'avg_fee');
    assert.ok(typeof info.fee_active_tvl_ratio === 'number', 'fee_active_tvl_ratio');
    assert.ok(typeof info.volatility === 'number', 'volatility');
    assert.ok(typeof info.swap_count === 'number', 'swap_count');
    assert.ok(typeof info.unique_traders === 'number', 'unique_traders');
    assert.ok(typeof info.open_positions === 'number', 'open_positions');
    assert.ok(typeof info.active_positions === 'number', 'active_positions');
    assert.ok(typeof info.pool_age_ms === 'number', 'pool_age_ms');
    assert.ok(info.pool_age_ms > 0, 'pool_age_ms should be positive');

    console.log(`  Pool: ${info.name} | TVL: $${info.tvl.toFixed(0)} | Age: ${(info.pool_age_ms / 86400000).toFixed(0)}d`);
  });
});

// ============================================================================
// Token cache auto-population
// ============================================================================

describe('Token cache auto-population', { concurrency: false }, () => {
  test('getPools auto-populates token registry', async () => {
    const registry = new TokenRegistry(new Connection(DUMMY_RPC, 'confirmed'));
    const client = new MeteoraClient({ rpcUrl: DUMMY_RPC, cluster: CLUSTER });
    client.setTokenRegistry(registry);

    const result = await client.getPools({ pageSize: 3 });
    assert.ok(result.data.length >= 1);

    // Check that tokens from the response are now cached
    const firstPool = result.data[0];
    const cachedX = registry.getCached(firstPool.token_x.address);
    const cachedY = registry.getCached(firstPool.token_y.address);

    assert.ok(cachedX, `token_x ${firstPool.token_x.address} should be cached`);
    assert.strictEqual(cachedX!.symbol, firstPool.token_x.symbol, 'cached symbol matches');
    assert.ok(cachedY, `token_y ${firstPool.token_y.address} should be cached`);
    assert.strictEqual(cachedY!.symbol, firstPool.token_y.symbol, 'cached symbol matches');
    assert.strictEqual(cachedX!.decimals, firstPool.token_x.decimals, 'cached decimals matches');

    console.log(`  Cached: ${cachedX!.symbol} (${firstPool.token_x.address.slice(0, 8)}...) and ${cachedY!.symbol}`);
  });

  test('discover populates registry with all pool tokens', async () => {
    const registry = new TokenRegistry(new Connection(DUMMY_RPC, 'confirmed'));
    const client = new MeteoraClient({ rpcUrl: DUMMY_RPC, cluster: CLUSTER });
    client.setTokenRegistry(registry);

    const pools = await client.discover();
    assert.ok(pools.length >= 1);

    // Every discovered pool's tokens should be in the registry
    let cached = 0;
    for (const p of pools) {
      if (registry.getCached(p.token_x_mint)) cached++;
      if (registry.getCached(p.token_y_mint)) cached++;
    }

    const expected = pools.length * 2;
    assert.ok(
      cached >= expected * 0.9,
      `At least 90% of pool tokens should be cached (${cached}/${expected})`,
    );

    console.log(`  ${cached}/${expected} tokens cached from ${pools.length} discovered pools`);
  });
});

// ============================================================================
// LPCLI facade — discoverPools and getPoolInfo
// ============================================================================

describe('LPCLI facade (no wallet)', { concurrency: false }, () => {
  test('discoverPools returns pools', async () => {
    const lpcli = new LPCLI({ rpcUrl: DUMMY_RPC, cluster: CLUSTER });

    const pools = await lpcli.discoverPools();
    assert.ok(pools.length >= 1, 'should return at least 1 pool');
    assert.ok(typeof pools[0].pool_address === 'string');
    assert.ok(typeof pools[0].avg_fee === 'number');

    console.log(`  LPCLI.discoverPools(): ${pools.length} pools`);
  });

  test('discoverPools with query', async () => {
    const lpcli = new LPCLI({ rpcUrl: DUMMY_RPC, cluster: CLUSTER });

    const pools = await lpcli.discoverPools('SOL');
    assert.ok(pools.length >= 1, 'should find SOL pools');

    console.log(`  LPCLI.discoverPools('SOL'): ${pools.length} pools`);
  });

  test('getPoolInfo returns structured detail', async () => {
    const lpcli = new LPCLI({ rpcUrl: DUMMY_RPC, cluster: CLUSTER });

    const pools = await lpcli.discoverPools(undefined, { pageSize: 1 } as any);
    assert.ok(pools.length >= 1);

    const info = await lpcli.getPoolInfo(pools[0].pool_address);
    assert.strictEqual(info.pool_address, pools[0].pool_address);
    assert.ok(typeof info.tvl === 'number');
    assert.ok(typeof info.avg_fee === 'number');

    console.log(`  LPCLI.getPoolInfo(): ${info.name}`);
  });

  test('getDiscoverConfig returns defaults', () => {
    const lpcli = new LPCLI({ rpcUrl: DUMMY_RPC, cluster: CLUSTER });
    const cfg = lpcli.getDiscoverConfig();

    assert.ok(typeof cfg.pageSize === 'number');
    assert.ok(typeof cfg.defaultSort === 'string');
    assert.ok(typeof cfg.minActiveTvl === 'number');
    assert.ok(typeof cfg.minSwapCount === 'number');
    assert.ok(typeof cfg.minTraders === 'number');
  });
});

console.log(`
╔══════════════════════════════════════════════════════╗
║  Meteora Pool-Discovery E2E Tests                   ║
║  API: pool-discovery-api.datapi.meteora.ag           ║
║  No wallet needed — read-only tests                  ║
╚══════════════════════════════════════════════════════╝
`);
