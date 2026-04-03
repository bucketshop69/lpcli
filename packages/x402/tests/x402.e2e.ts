/**
 * @lpcli/x402 E2E Tests
 *
 * Tests the x402 HTTP server endpoints using native fetch.
 * Run with: pnpm --filter @lpcli/x402 test:e2e
 *
 * Starts the server on a random port, runs all tests, then shuts down.
 * No wallet needed — tests cover free endpoints + 402 payment gate.
 * Position operations (open with real payment, close, claim) require a funded wallet.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, '../dist/index.js');

// Use a random port to avoid conflicts
const TEST_PORT = 34020 + Math.floor(Math.random() * 1000);
const BASE_URL = `http://localhost:${TEST_PORT}`;

let server: ChildProcess;

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

async function waitForServer(url: string, maxWaitMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server did not start within ${maxWaitMs}ms`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('x402 HTTP Server', { concurrency: false }, () => {

  before(async () => {
    server = spawn('node', [SERVER_PATH], {
      env: {
        ...process.env,
        X402_PORT: String(TEST_PORT),
        X402_TREASURY_WALLET: 'TestTreasuryWallet11111111111111111111111111',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    server.stderr!.on('data', (chunk: Buffer) => {
      const msg = chunk.toString();
      if (msg.includes('Error') && !msg.includes('EADDRINUSE')) {
        console.error('  server stderr:', msg.trim());
      }
    });

    await waitForServer(BASE_URL);
    console.log(`  ✓ Server started on port ${TEST_PORT}`);
  });

  after(() => {
    if (server) {
      server.kill();
    }
  });

  // ── Health ────────────────────────────────────────────────────────────────

  test('GET /health — returns ok', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    assert.strictEqual(res.status, 200);

    const body = await res.json() as { status: string; version: string };
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(body.version, '0.1.0');

    console.log('  ✓ Health: ok, v0.1.0');
  });

  // ── CORS ──────────────────────────────────────────────────────────────────

  test('OPTIONS — returns CORS headers', async () => {
    const res = await fetch(`${BASE_URL}/discover`, { method: 'OPTIONS' });
    assert.strictEqual(res.status, 204);
    assert.ok(res.headers.get('access-control-allow-origin'), 'should have CORS origin header');
    assert.ok(
      res.headers.get('access-control-allow-headers')?.includes('x-402-receipt'),
      'should allow x-402-receipt header'
    );

    console.log('  ✓ CORS preflight passes, x-402-receipt allowed');
  });

  // ── Discover ──────────────────────────────────────────────────────────────

  test('GET /discover?token=SOL — returns ranked pools (live)', async () => {
    const res = await fetch(`${BASE_URL}/discover?token=SOL&limit=3`);
    assert.strictEqual(res.status, 200);

    const body = await res.json() as { pools: Array<{ address: string; name: string; score: number; tvl: number }> };
    assert.ok(Array.isArray(body.pools), 'should return pools array');
    assert.ok(body.pools.length >= 1, 'should return at least 1 pool');
    assert.ok(body.pools.length <= 3, 'should respect limit=3');

    const pool = body.pools[0];
    assert.ok(pool.address, 'pool should have address');
    assert.ok(pool.name, 'pool should have name');
    assert.ok(typeof pool.score === 'number', 'pool should have numeric score');
    assert.ok(typeof pool.tvl === 'number', 'pool should have numeric tvl');

    // Pools should be sorted by score descending
    for (let i = 1; i < body.pools.length; i++) {
      assert.ok(
        body.pools[i - 1].score >= body.pools[i].score,
        'pools should be sorted by score desc'
      );
    }

    console.log(`  ✓ Discovered ${body.pools.length} SOL pools, top: ${pool.name} (score: ${pool.score.toFixed(1)})`);
  });

  test('GET /discover — missing token returns 400', async () => {
    const res = await fetch(`${BASE_URL}/discover`);
    assert.strictEqual(res.status, 400);

    const body = await res.json() as { error: string };
    assert.ok(body.error.includes('token'), 'error should mention token');

    console.log('  ✓ Missing token returns 400');
  });

  // ── Pool Info ─────────────────────────────────────────────────────────────

  test('GET /pool/:address — returns pool details (live)', async () => {
    // First get a real pool address
    const discoverRes = await fetch(`${BASE_URL}/discover?token=SOL&limit=1`);
    const { pools } = await discoverRes.json() as { pools: Array<{ address: string }> };
    assert.ok(pools.length >= 1, 'need at least 1 pool');
    const poolAddress = pools[0].address;

    const res = await fetch(`${BASE_URL}/pool/${poolAddress}`);
    assert.strictEqual(res.status, 200);

    const body = await res.json() as { pool: { address: string; tvl: number; bin_step: number; current_price: number } };
    assert.ok(body.pool, 'should return pool object');
    assert.strictEqual(body.pool.address, poolAddress, 'should match requested address');
    assert.ok(typeof body.pool.tvl === 'number', 'should have tvl');
    assert.ok(typeof body.pool.bin_step === 'number', 'should have bin_step');
    assert.ok(typeof body.pool.current_price === 'number', 'should have current_price');

    console.log(`  ✓ Pool info for ${poolAddress}: TVL $${body.pool.tvl.toFixed(0)}, bin step ${body.pool.bin_step}`);
  });

  test('GET /pool/ — missing address returns 400', async () => {
    const res = await fetch(`${BASE_URL}/pool/`);
    assert.strictEqual(res.status, 400);

    console.log('  ✓ Missing pool address returns 400');
  });

  // ── Open Position (x402 gate) ─────────────────────────────────────────────

  test('POST /open — without payment returns 402 with fee details', async () => {
    const res = await fetch(`${BASE_URL}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pool: 'TestPool11111111111111111111111111111111111',
        amount_x: 1_000_000_000, // 1 SOL
      }),
    });

    assert.strictEqual(res.status, 402, 'should return 402 Payment Required');

    // Check x402 headers
    assert.strictEqual(res.headers.get('x-402-version'), '1', 'should have x-402-version header');
    const paymentB64 = res.headers.get('x-402-payment');
    assert.ok(paymentB64, 'should have x-402-payment header');

    // Decode base64 payment header
    const paymentJson = Buffer.from(paymentB64, 'base64').toString('utf-8');
    const paymentHeader = JSON.parse(paymentJson) as {
      chain: string;
      currency: string;
      amount: number;
      recipient: string;
      fee_bps: number;
    };
    assert.strictEqual(paymentHeader.chain, 'solana:mainnet');
    assert.strictEqual(paymentHeader.currency, 'SOL');
    assert.strictEqual(paymentHeader.fee_bps, 2);

    // Fee should be 2 bps on 1 SOL = 200,000 lamports
    assert.strictEqual(paymentHeader.amount, 200_000, 'fee should be 200,000 lamports (2 bps on 1 SOL)');

    // Body should also contain payment info
    const body = await res.json() as { error: string; payment: { amount: number } };
    assert.strictEqual(body.error, 'Payment Required');
    assert.strictEqual(body.payment.amount, 200_000);

    console.log(`  ✓ 402 returned: fee = ${paymentHeader.amount} lamports (${paymentHeader.amount / 1e9} SOL)`);
  });

  test('POST /open — fee scales with position size', async () => {
    // 10 SOL position
    const res = await fetch(`${BASE_URL}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pool: 'TestPool11111111111111111111111111111111111',
        amount_x: 5_000_000_000,  // 5 SOL
        amount_y: 5_000_000_000,  // 5 SOL equivalent
      }),
    });

    assert.strictEqual(res.status, 402);

    const body = await res.json() as { payment: { amount: number } };
    // 2 bps on 10 SOL (10B lamports) = 2,000,000 lamports
    assert.strictEqual(body.payment.amount, 2_000_000, 'fee should be 2M lamports (2 bps on 10 SOL)');

    console.log(`  ✓ Fee scales: 10 SOL position → ${body.payment.amount} lamports fee`);
  });

  test('POST /open — with receipt passes payment gate (fails at wallet)', async () => {
    const receipt = JSON.stringify({
      tx: 'FakeSignature123456789abcdef',
      amount: 200_000,
      chain: 'solana:mainnet',
    });

    const res = await fetch(`${BASE_URL}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-402-receipt': receipt,
      },
      body: JSON.stringify({
        pool: 'TestPool11111111111111111111111111111111111',
        amount_x: 1_000_000_000,
      }),
    });

    // Should NOT be 402 (payment accepted), but will fail at wallet init
    assert.notStrictEqual(res.status, 402, 'should not return 402 with valid receipt');
    assert.strictEqual(res.status, 500, 'should fail at wallet init (no wallet configured)');

    const body = await res.json() as { error: string };
    assert.ok(
      body.error.includes('wallet') || body.error.includes('Wallet'),
      'error should be about missing wallet, not payment'
    );

    console.log('  ✓ Receipt accepted, fails at wallet (expected — no wallet configured)');
  });

  test('POST /open — missing pool returns 400', async () => {
    const res = await fetch(`${BASE_URL}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.strictEqual(res.status, 400);

    const body = await res.json() as { error: string };
    assert.ok(body.error.includes('pool'), 'error should mention pool');

    console.log('  ✓ Missing pool returns 400');
  });

  // ── Close / Claim (free, but need wallet) ─────────────────────────────────

  test('POST /close — free but requires wallet', async () => {
    const res = await fetch(`${BASE_URL}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position: 'TestPosition1111111111111111111111111111111' }),
    });

    // Should NOT return 402 (close is free)
    assert.notStrictEqual(res.status, 402, 'close should not require payment');
    // Should fail at wallet, not at payment
    assert.strictEqual(res.status, 500);

    const body = await res.json() as { error: string };
    assert.ok(
      body.error.includes('wallet') || body.error.includes('Wallet'),
      'error should be about wallet, not payment'
    );

    console.log('  ✓ Close is free (no 402), fails at wallet as expected');
  });

  test('POST /claim — free but requires wallet', async () => {
    const res = await fetch(`${BASE_URL}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position: 'TestPosition1111111111111111111111111111111' }),
    });

    assert.notStrictEqual(res.status, 402, 'claim should not require payment');
    assert.strictEqual(res.status, 500);

    console.log('  ✓ Claim is free (no 402), fails at wallet as expected');
  });

  // ── 404 ───────────────────────────────────────────────────────────────────

  test('GET /nonexistent — returns 404', async () => {
    const res = await fetch(`${BASE_URL}/nonexistent`);
    assert.strictEqual(res.status, 404);

    console.log('  ✓ Unknown routes return 404');
  });
});
