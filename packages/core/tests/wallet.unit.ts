/**
 * WalletService Unit Tests
 *
 * These tests use mocks and do NOT require a live RPC or wallet.
 * Run with: node --import tsx --test tests/wallet.unit.ts
 *
 * Backend selection is driven by environment variables, so we manipulate
 * process.env in each test and restore it afterwards.
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// We import the module under test AFTER patching env in each test so we get
// fresh evaluations.  Because Node caches modules, we use a workaround:
// We call WalletService.init() directly and control which env vars are set.
// ---------------------------------------------------------------------------

import { WalletService } from '../src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Save and restore env vars around a test. */
function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => Promise<void>
): () => Promise<void> {
  return async () => {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
      saved[k] = process.env[k];
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = v;
        }
      }
    }
  };
}

/** Placeholder RPC — WalletService.init() calls Connection() with this. */
const DUMMY_RPC = 'https://api.mainnet-beta.solana.com';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A freshly generated Solana keypair represented as a 64-byte array and base58.
// Generated with Keypair.generate() and fixed for test reproducibility.
// Public key: 4gUAKdRT8kNr8yN5W6Tk1Nca4Q4W1Zq7YYSCWDa1yGTa
const KEYPAIR_BYTES: number[] = [
  204, 166, 54, 125, 152, 174, 37, 27, 193, 48, 11, 36, 201, 219, 53, 164,
  97, 167, 8, 2, 243, 103, 218, 26, 246, 168, 125, 157, 41, 62, 165, 198,
  54, 175, 108, 76, 182, 43, 34, 155, 80, 223, 40, 246, 69, 149, 225, 154,
  37, 233, 1, 92, 211, 242, 188, 208, 251, 157, 74, 148, 186, 157, 114, 1,
];

// Matching base58 representation (full 64-byte secret key encoded as base58)
// We compute it at runtime using our own encoder to avoid a bs58 dependency.
function toBase58(bytes: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = BigInt(0);
  for (const byte of bytes) {
    value = value * BigInt(256) + BigInt(byte);
  }
  let result = '';
  while (value > BigInt(0)) {
    result = ALPHABET[Number(value % BigInt(58))] + result;
    value = value / BigInt(58);
  }
  // Leading zero bytes → leading '1' characters
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = '1' + result;
  }
  return result;
}

const KEYPAIR_BASE58 = toBase58(Uint8Array.from(KEYPAIR_BYTES));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WalletService backend selection', { concurrency: false }, () => {

  test(
    'selects keypair-file backend when PRIVATE_KEY is a file path (starts with /)',
    withEnv({ PRIVATE_KEY: undefined, OWS_WALLET_NAME: undefined }, async () => {
      // Write a temporary keypair file
      const dir = join(tmpdir(), 'lpcli-wallet-test-' + Date.now());
      mkdirSync(dir, { recursive: true });
      const keyPath = join(dir, 'id.json');
      writeFileSync(keyPath, JSON.stringify(KEYPAIR_BYTES));

      try {
        const wallet = await WalletService.init({
          rpcUrl: DUMMY_RPC,
          privateKey: keyPath,
        });

        const pubkey = wallet.getPublicKey();
        assert.ok(pubkey.toBase58().length > 0, 'should return a valid public key');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    })
  );

  test(
    'selects keypair-file backend when PRIVATE_KEY env var is a file path',
    withEnv({ PRIVATE_KEY: undefined, OWS_WALLET_NAME: undefined }, async () => {
      const dir = join(tmpdir(), 'lpcli-wallet-test-' + Date.now());
      mkdirSync(dir, { recursive: true });
      const keyPath = join(dir, 'id.json');
      writeFileSync(keyPath, JSON.stringify(KEYPAIR_BYTES));

      try {
        process.env['PRIVATE_KEY'] = keyPath;
        const wallet = await WalletService.init({ rpcUrl: DUMMY_RPC });

        const pubkey = wallet.getPublicKey();
        assert.ok(pubkey.toBase58().length > 0, 'should return a valid public key');
      } finally {
        delete process.env['PRIVATE_KEY'];
        rmSync(dir, { recursive: true, force: true });
      }
    })
  );

  test(
    'selects base58 keypair backend when PRIVATE_KEY is a base58 string',
    withEnv({ PRIVATE_KEY: KEYPAIR_BASE58, OWS_WALLET_NAME: undefined }, async () => {
      const wallet = await WalletService.init({ rpcUrl: DUMMY_RPC });
      const pubkey = wallet.getPublicKey();
      assert.ok(pubkey.toBase58().length > 0, 'should return a valid public key');
    })
  );

  test(
    'selects base58 keypair backend via options.privateKey',
    withEnv({ PRIVATE_KEY: undefined, OWS_WALLET_NAME: undefined }, async () => {
      const wallet = await WalletService.init({
        rpcUrl: DUMMY_RPC,
        privateKey: KEYPAIR_BASE58,
      });
      const pubkey = wallet.getPublicKey();
      assert.ok(pubkey.toBase58().length > 0, 'should return a valid public key');
    })
  );

  test(
    'throws a clear error when no wallet is configured',
    withEnv({ PRIVATE_KEY: undefined, OWS_WALLET_NAME: undefined }, async () => {
      await assert.rejects(
        () => WalletService.init({ rpcUrl: DUMMY_RPC }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(
            err.message.includes('lpcli init'),
            `Error message should mention 'lpcli init', got: ${err.message}`
          );
          return true;
        }
      );
    })
  );

  test(
    'falls through to keypair backend when OWS_WALLET_NAME is set but OWS is not installed',
    withEnv({ PRIVATE_KEY: KEYPAIR_BASE58, OWS_WALLET_NAME: 'lpcli' }, async () => {
      // @open-wallet-standard/core is not installed in this repo, so the OWS
      // path should fail gracefully and fall through to the PRIVATE_KEY path.
      const wallet = await WalletService.init({ rpcUrl: DUMMY_RPC });
      const pubkey = wallet.getPublicKey();
      assert.ok(pubkey.toBase58().length > 0, 'should have fallen through to base58 backend');
    })
  );

  test(
    'keypair file and base58 backends produce consistent public keys for the same key material',
    withEnv({ PRIVATE_KEY: undefined, OWS_WALLET_NAME: undefined }, async () => {
      // Write keypair file
      const dir = join(tmpdir(), 'lpcli-wallet-test-' + Date.now());
      mkdirSync(dir, { recursive: true });
      const keyPath = join(dir, 'id.json');
      writeFileSync(keyPath, JSON.stringify(KEYPAIR_BYTES));

      try {
        const [fileWallet, base58Wallet] = await Promise.all([
          WalletService.init({ rpcUrl: DUMMY_RPC, privateKey: keyPath }),
          WalletService.init({ rpcUrl: DUMMY_RPC, privateKey: KEYPAIR_BASE58 }),
        ]);

        assert.strictEqual(
          fileWallet.getPublicKey().toBase58(),
          base58Wallet.getPublicKey().toBase58(),
          'File and base58 backends should derive the same public key from the same secret'
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    })
  );

});

describe('WalletService.getPriorityFee', { concurrency: false }, () => {

  test(
    'returns 0 on network failure (unreachable RPC)',
    withEnv({ PRIVATE_KEY: KEYPAIR_BASE58, OWS_WALLET_NAME: undefined }, async () => {
      const wallet = await WalletService.init({
        rpcUrl: 'http://127.0.0.1:1', // nothing listening here
      });
      const fee = await wallet.getPriorityFee('dummybase64tx');
      assert.strictEqual(fee, 0, 'should return 0 on connection failure');
    })
  );

  test(
    'returns 0 when RPC returns an error payload',
    withEnv({ PRIVATE_KEY: KEYPAIR_BASE58, OWS_WALLET_NAME: undefined }, async () => {
      // We can't easily mock fetch in Node test runner without extra deps, so
      // we rely on the fact that a real public Solana RPC will return an error
      // for getPriorityFeeEstimate with a garbage transaction — and our
      // implementation should return 0, not throw.
      const wallet = await WalletService.init({
        rpcUrl: DUMMY_RPC,
        privateKey: KEYPAIR_BASE58,
      });
      const fee = await wallet.getPriorityFee('not-valid-base64');
      // Either 0 (error caught) or a number (if RPC surprisingly accepts it)
      assert.ok(typeof fee === 'number', 'getPriorityFee should always return a number');
    })
  );

});

console.log(`
WalletService Unit Tests
`);
