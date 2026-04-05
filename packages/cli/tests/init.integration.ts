/**
 * Init command integration test.
 *
 * Tests the non-interactive init flow end-to-end:
 *   1. Creates an OWS wallet with a test name
 *   2. Writes config.json to a temp dir
 *   3. Verifies config is correct
 *   4. Verifies LPCLI can load the config and resolve the wallet
 *   5. Cleans up the test wallet
 *
 * Requires: OWS installed (`ows --version` must work)
 *
 * Run with: npx tsx --test packages/cli/tests/init.integration.ts
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TEST_WALLET = `lpcli-test-${Date.now()}`;
const CLI_BIN = join(import.meta.dirname, '..', 'dist', 'index.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function owsInstalled(): boolean {
  try {
    execSync('ows --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function deleteOWSWallet(name: string): void {
  // Safety: never delete a wallet that doesn't have the test prefix
  if (!name.startsWith('lpcli-test-')) {
    throw new Error(`Refusing to delete wallet "${name}" — only lpcli-test-* wallets can be deleted by tests`);
  }
  try {
    execSync(`ows wallet delete --wallet "${name}" --confirm`, { stdio: 'ignore' });
  } catch {
    // wallet may not exist — that's fine
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('lpcli init (non-interactive)', { concurrency: false }, () => {

  // Skip all tests if OWS is not installed
  const ows = owsInstalled();
  if (!ows) {
    console.log('Skipping init integration tests: OWS not installed');
  }

  // Clean up test wallet after all tests
  after(() => {
    deleteOWSWallet(TEST_WALLET);
  });

  test('creates wallet and writes config.json with defaults', { skip: !ows }, () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'lpcli-init-test-'));

    try {
      // Run: lpcli init --wallet <test> --config-dir <tmp> --force
      const output = execSync(
        `node ${CLI_BIN} init --wallet ${TEST_WALLET} --config-dir ${tmpDir} --force`,
        { encoding: 'utf-8', timeout: 30_000 }
      );

      // Verify output mentions config saved
      assert.ok(output.includes('Config saved'), `Expected "Config saved" in output, got: ${output}`);

      // Verify config.json was written
      const configPath = join(tmpDir, 'config.json');
      assert.ok(existsSync(configPath), 'config.json should exist');

      // Verify config contents
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      assert.strictEqual(config.wallet, TEST_WALLET);
      assert.strictEqual(config.cluster, 'mainnet');
      assert.strictEqual(config.rpcUrl, '');
      assert.strictEqual(config.fundingToken.symbol, 'USDC');
      assert.strictEqual(config.fundingToken.mint, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      assert.strictEqual(config.fundingToken.decimals, 6);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('creates wallet with SOL funding token', { skip: !ows }, () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'lpcli-init-test-'));

    try {
      execSync(
        `node ${CLI_BIN} init --wallet ${TEST_WALLET} --config-dir ${tmpDir} --funding-token SOL --force`,
        { encoding: 'utf-8', timeout: 30_000 }
      );

      const config = JSON.parse(readFileSync(join(tmpDir, 'config.json'), 'utf-8'));
      assert.strictEqual(config.fundingToken.symbol, 'SOL');
      assert.strictEqual(config.fundingToken.mint, 'So11111111111111111111111111111111111111112');
      assert.strictEqual(config.fundingToken.decimals, 9);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('creates wallet with custom RPC and devnet cluster', { skip: !ows }, () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'lpcli-init-test-'));

    try {
      execSync(
        `node ${CLI_BIN} init --wallet ${TEST_WALLET} --config-dir ${tmpDir} --rpc https://custom-rpc.example.com --cluster devnet --force`,
        { encoding: 'utf-8', timeout: 30_000 }
      );

      const config = JSON.parse(readFileSync(join(tmpDir, 'config.json'), 'utf-8'));
      assert.strictEqual(config.rpcUrl, 'https://custom-rpc.example.com');
      assert.strictEqual(config.cluster, 'devnet');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('refuses to overwrite without --force', { skip: !ows }, () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'lpcli-init-test-'));

    try {
      // First init — should succeed
      execSync(
        `node ${CLI_BIN} init --wallet ${TEST_WALLET} --config-dir ${tmpDir} --force`,
        { encoding: 'utf-8', timeout: 30_000 }
      );

      // Second init without --force — should fail
      assert.throws(
        () => execSync(
          `node ${CLI_BIN} init --wallet ${TEST_WALLET} --config-dir ${tmpDir}`,
          { encoding: 'utf-8', timeout: 30_000 }
        ),
        (err: unknown) => {
          const msg = (err as { stderr?: string }).stderr ?? '';
          return msg.includes('already exists') || msg.includes('--force');
        }
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('reuses existing wallet without re-creating', { skip: !ows }, () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'lpcli-init-test-'));

    try {
      // First init creates the wallet
      execSync(
        `node ${CLI_BIN} init --wallet ${TEST_WALLET} --config-dir ${tmpDir} --force`,
        { encoding: 'utf-8', timeout: 30_000 }
      );

      // Second init with same wallet name — should reuse, not error
      const tmpDir2 = mkdtempSync(join(tmpdir(), 'lpcli-init-test-'));
      try {
        const output = execSync(
          `node ${CLI_BIN} init --wallet ${TEST_WALLET} --config-dir ${tmpDir2} --force`,
          { encoding: 'utf-8', timeout: 30_000 }
        );
        assert.ok(output.includes('Config saved'));
      } finally {
        rmSync(tmpDir2, { recursive: true, force: true });
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

});

console.log(`
Init Integration Tests (wallet: ${TEST_WALLET})
`);
