/**
 * Init command integration test.
 *
 * Tests the non-interactive init flow end-to-end:
 *   1. Uses the existing "lpcli" OWS wallet (wallet name is fixed)
 *   2. Writes config.json to a temp dir
 *   3. Verifies config is correct
 *   4. Cleans up temp dirs
 *
 * Requires: OWS installed + "lpcli" wallet exists
 *
 * Run with: npx tsx --test packages/cli/tests/init.integration.ts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('lpcli init (non-interactive)', { concurrency: false }, () => {

  const ows = owsInstalled();
  if (!ows) {
    console.log('Skipping init integration tests: OWS not installed');
  }

  test('creates config.json with defaults', { skip: !ows }, () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'lpcli-init-test-'));

    try {
      const output = execSync(
        `node ${CLI_BIN} init --config-dir ${tmpDir} --force`,
        { encoding: 'utf-8', timeout: 30_000 }
      );

      assert.ok(output.includes('Config saved'), `Expected "Config saved" in output, got: ${output}`);

      const configPath = join(tmpDir, 'config.json');
      assert.ok(existsSync(configPath), 'config.json should exist');

      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      assert.strictEqual(config.wallet, 'lpcli');
      assert.strictEqual(config.cluster, 'mainnet');
      assert.strictEqual(config.fundingToken.symbol, 'USDC');
      assert.strictEqual(config.fundingToken.mint, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      assert.strictEqual(config.fundingToken.decimals, 6);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('creates config with SOL funding token', { skip: !ows }, () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'lpcli-init-test-'));

    try {
      execSync(
        `node ${CLI_BIN} init --config-dir ${tmpDir} --funding-token SOL --force`,
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

  test('creates config with custom RPC and devnet cluster', { skip: !ows }, () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'lpcli-init-test-'));

    try {
      execSync(
        `node ${CLI_BIN} init --config-dir ${tmpDir} --rpc https://custom-rpc.example.com --cluster devnet --force`,
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
      // First init
      execSync(
        `node ${CLI_BIN} init --config-dir ${tmpDir} --force`,
        { encoding: 'utf-8', timeout: 30_000 }
      );

      // Second init without --force — should fail
      assert.throws(
        () => execSync(
          `node ${CLI_BIN} init --config-dir ${tmpDir}`,
          { encoding: 'utf-8', timeout: 30_000 }
        ),
        (err: unknown) => {
          const stderr = (err as { stderr?: string }).stderr ?? '';
          return stderr.includes('already exists') || stderr.includes('--force');
        }
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('--force overwrites existing config', { skip: !ows }, () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'lpcli-init-test-'));

    try {
      // First init with USDC
      execSync(
        `node ${CLI_BIN} init --config-dir ${tmpDir} --force`,
        { encoding: 'utf-8', timeout: 30_000 }
      );

      // Overwrite with SOL
      execSync(
        `node ${CLI_BIN} init --config-dir ${tmpDir} --funding-token SOL --force`,
        { encoding: 'utf-8', timeout: 30_000 }
      );

      const config = JSON.parse(readFileSync(join(tmpDir, 'config.json'), 'utf-8'));
      assert.strictEqual(config.fundingToken.symbol, 'SOL', 'config should be overwritten with SOL');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

});

console.log(`
Init Integration Tests
`);
