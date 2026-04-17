/**
 * pacific Signing E2E Tests
 *
 * Tests 1-3, 7: Pure logic — no OWS needed, always run.
 * Tests 4-6: Require OWS wallet "lpcli" — skip gracefully if unavailable.
 *
 * Run with: pnpm --filter @lpcli/core test:e2e:signing
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { preparepacificMessage, signpacificRequest, WalletService } from '../src/index.js';

const DUMMY_RPC = 'https://api.mainnet-beta.solana.com';

// ---------------------------------------------------------------------------
// Helper: try to init OWS wallet, return null if unavailable
// ---------------------------------------------------------------------------

async function tryInitWallet(): Promise<WalletService | null> {
  try {
    return await WalletService.init('lpcli', DUMMY_RPC);
  } catch {
    console.log('  Skipping: OWS wallet "lpcli" not available');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pure logic tests (no OWS)
// ---------------------------------------------------------------------------

describe('preparepacificMessage', { concurrency: false }, () => {

  test('1: sorts keys recursively and produces compact JSON', () => {
    const header = { type: 'create_market_order', timestamp: 1700000000000, expiry_window: 5000 };
    const payload = {
      symbol: 'BTC',
      side: 'bid',
      amount: '0.001',
      reduce_only: false,
      slippage_percent: '0.5',
      client_order_id: 'test-uuid',
    };

    const result = preparepacificMessage(header, payload);

    // No spaces anywhere
    assert.ok(!result.includes(' '), 'output should have no spaces');

    const parsed = JSON.parse(result);

    // Top-level keys should be sorted
    const topKeys = Object.keys(parsed);
    const sortedTopKeys = [...topKeys].sort();
    assert.deepStrictEqual(topKeys, sortedTopKeys, 'top-level keys should be sorted');

    // data sub-keys should be sorted
    const dataKeys = Object.keys(parsed.data);
    const sortedDataKeys = [...dataKeys].sort();
    assert.deepStrictEqual(dataKeys, sortedDataKeys, 'data keys should be sorted');

    // Header fields present at top level
    assert.strictEqual(parsed.type, 'create_market_order');
    assert.strictEqual(parsed.timestamp, 1700000000000);
    assert.strictEqual(parsed.expiry_window, 5000);

    // Payload under data
    assert.strictEqual(parsed.data.symbol, 'BTC');
    assert.strictEqual(parsed.data.side, 'bid');
    assert.strictEqual(parsed.data.amount, '0.001');
  });

  test('2: idempotency — same input always produces identical output', () => {
    const header = { timestamp: 1700000000000, expiry_window: 5000, type: 'cancel_all_orders' };
    const payload = {};

    const result1 = preparepacificMessage(header, payload);
    const result2 = preparepacificMessage(header, payload);

    assert.strictEqual(result1, result2, 'identical inputs should produce identical output');
  });

  test('3: throws on missing header fields', () => {
    assert.throws(
      () => preparepacificMessage({ type: 'x', timestamp: 1 } as any, {}),
      /expiry_window/,
    );
    assert.throws(
      () => preparepacificMessage({ type: 'x', expiry_window: 1 } as any, {}),
      /timestamp/,
    );
    assert.throws(
      () => preparepacificMessage({ timestamp: 1, expiry_window: 1 } as any, {}),
      /type/,
    );
  });

});

// ---------------------------------------------------------------------------
// OWS-dependent tests
// ---------------------------------------------------------------------------

describe('WalletService.signMessage', { concurrency: false }, () => {

  test('4: returns valid 64-byte ed25519 signature', async () => {
    const wallet = await tryInitWallet();
    if (!wallet) return;

    const message = new TextEncoder().encode('test message for signing');
    const signature = await wallet.signMessage(message);

    assert.strictEqual(signature.length, 64, 'signature should be 64 bytes');

    const pubkey = wallet.getPublicKey();
    const valid = nacl.sign.detached.verify(message, signature, pubkey.toBytes());
    assert.ok(valid, 'signature should verify with tweetnacl');
  });

});

describe('signpacificRequest', { concurrency: false }, () => {

  test('5: full round-trip — sign and verify', async () => {
    const wallet = await tryInitWallet();
    if (!wallet) return;

    const header = { type: 'create_market_order', timestamp: Date.now(), expiry_window: 5000 };
    const payload = {
      symbol: 'SOL',
      side: 'bid',
      amount: '1.0',
      reduce_only: false,
      slippage_percent: '0.5',
      client_order_id: 'e2e-test',
    };

    const envelope = await signpacificRequest(wallet, header, payload);

    // Envelope shape
    assert.strictEqual(envelope.account, wallet.getPublicKey().toBase58());
    assert.ok(typeof envelope.signature === 'string');
    assert.strictEqual(envelope.timestamp, header.timestamp);
    assert.strictEqual(envelope.expiry_window, header.expiry_window);
    assert.strictEqual(envelope.symbol, 'SOL');
    assert.strictEqual(envelope.side, 'bid');

    // Verify signature
    const sigBytes = bs58.decode(envelope.signature);
    const message = preparepacificMessage(header, payload);
    const messageBytes = new TextEncoder().encode(message);
    const pubkey = wallet.getPublicKey();
    const valid = nacl.sign.detached.verify(messageBytes, sigBytes, pubkey.toBytes());
    assert.ok(valid, 'envelope signature should verify');
  });

  test('6: live pacific API smoke test', async () => {
    const wallet = await tryInitWallet();
    if (!wallet) return;

    const pubkey = wallet.getPublicKey().toBase58();
    const resp = await fetch(`https://api.pacific.fi/api/v1/account?account=${pubkey}`);
    const body = await resp.json() as { success: boolean; error?: string; code?: number };

    if (resp.status === 404) {
      // Account not yet registered on pacific — API is reachable, that's the smoke test
      assert.strictEqual(body.code, 404, 'should return 404 code for unknown account');
      assert.ok(typeof body.error === 'string', 'should have error message');
    } else {
      assert.ok(resp.ok, `pacific API responded ${resp.status}`);
      assert.strictEqual(body.success, true, 'pacific API should return success');
    }
  });

});

// ---------------------------------------------------------------------------
// Nested sorting test (no OWS)
// ---------------------------------------------------------------------------

describe('preparepacificMessage nested sorting', { concurrency: false }, () => {

  test('7: nested payload keys (TPSL) are sorted', () => {
    const header = { type: 'set_position_tpsl', timestamp: 1700000000000, expiry_window: 5000 };
    const payload = {
      symbol: 'BTC',
      side: 'ask',
      stop_loss: {
        stop_price: '95000',
        amount: '0.001',
        client_order_id: 'sl-uuid',
      },
    };

    const result = preparepacificMessage(header, payload);
    const parsed = JSON.parse(result);

    const slKeys = Object.keys(parsed.data.stop_loss);
    const sortedSlKeys = [...slKeys].sort();
    assert.deepStrictEqual(slKeys, sortedSlKeys, 'stop_loss keys should be sorted');
  });

});

console.log(`
pacific Signing E2E Tests
`);
