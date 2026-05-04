/**
 * User-space onboarding E2E.
 *
 * This is intentionally hermetic: every test gets its own HOME/XDG dirs and OWS
 * wallet store. It must never touch the developer's real wallet or repo .env.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CLI_BIN = resolve(__dirname, '..', 'dist', 'index.js');
const OWS_BIN_DIR = resolve(REPO_ROOT, 'packages', 'core', 'node_modules', '.bin');
const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';
const CUSTOM_RPC = 'https://rpc.example.invalid';

interface Sandbox {
  root: string;
  home: string;
  xdgConfigHome: string;
  xdgDataHome: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'lpcli-user-e2e-'));
  const home = join(root, 'home');
  const xdgConfigHome = join(root, 'xdg-config');
  const xdgDataHome = join(root, 'xdg-data');
  const cwd = join(root, 'workdir');

  mkdirSync(home, { recursive: true });
  mkdirSync(xdgConfigHome, { recursive: true });
  mkdirSync(xdgDataHome, { recursive: true });
  mkdirSync(cwd, { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: xdgConfigHome,
    XDG_DATA_HOME: xdgDataHome,
    // Ensure init finds the workspace OWS binary, not a global/user install.
    PATH: `${OWS_BIN_DIR}:${process.env['PATH'] ?? ''}`,
    // If a future regression tries npm -g, keep it away from the real user prefix.
    NPM_CONFIG_PREFIX: join(root, 'npm-global'),
  };

  // Prevent ambient shell env from overriding config under test.
  for (const key of [
    'RPC_URL',
    'SOLANA_RPC_URL',
    'READ_RPC_URL',
    'OWS_WALLET',
    'CLUSTER',
    'FUNDING_TOKEN_MINT',
    'FUNDING_TOKEN_SYMBOL',
    'FUNDING_TOKEN_DECIMALS',
    'FEE_RESERVE_SOL',
  ]) {
    delete env[key];
  }

  return { root, home, xdgConfigHome, xdgDataHome, cwd, env };
}

function runCli(sb: Sandbox, args: string[], cwd = sb.cwd): string {
  return execFileSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    env: sb.env,
    encoding: 'utf-8',
    timeout: 60_000,
  });
}

function readUserConfig(sb: Sandbox): Record<string, unknown> {
  return JSON.parse(readFileSync(join(sb.xdgConfigHome, 'lpcli', 'config.json'), 'utf-8')) as Record<string, unknown>;
}

describe('lpcli user-space onboarding', { concurrency: false }, () => {
  test('init writes config/env under XDG user space and wallet address works from any cwd', () => {
    assert.ok(existsSync(CLI_BIN), 'CLI dist must exist; run pnpm build first');
    assert.ok(existsSync(join(OWS_BIN_DIR, 'ows')), 'workspace OWS binary must exist');

    const sb = makeSandbox();
    try {
      const output = runCli(sb, ['init', '--force', '--rpc', CUSTOM_RPC]);
      assert.match(output, /Config saved/);
      assert.match(output, /Wallet: lpcli/);

      const userConfigDir = join(sb.xdgConfigHome, 'lpcli');
      const configPath = join(userConfigDir, 'config.json');
      const envPath = join(userConfigDir, '.env');

      assert.ok(existsSync(configPath), 'config.json should be in XDG_CONFIG_HOME/lpcli');
      assert.ok(existsSync(envPath), '.env should be next to user config');
      assert.ok(!existsSync(join(sb.cwd, '.env')), 'init must not write .env to cwd');
      assert.ok(!existsSync(join(REPO_ROOT, '.env')), 'init must not create repo .env');
      assert.ok(existsSync(join(sb.home, '.ows', 'wallets')), 'OWS store should be inside sandbox HOME');

      const config = readUserConfig(sb);
      assert.strictEqual(config.wallet, 'lpcli');
      assert.strictEqual(config.cluster, 'mainnet');
      assert.strictEqual(config.feeReserveSol, 0.08);
      assert.deepStrictEqual(config.fundingToken, {
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        symbol: 'USDC',
        decimals: 6,
      });
      assert.ok(!('rpcUrl' in config), 'RPC URL belongs in user .env, not config.json');

      const envFile = readFileSync(envPath, 'utf-8');
      assert.match(envFile, new RegExp(`^RPC_URL=${CUSTOM_RPC}$`, 'm'));
      assert.strictEqual(statSync(envPath).mode & 0o777, 0o600, '.env should be user-private');

      const randomCwd = join(sb.root, 'somewhere-else');
      mkdirSync(randomCwd, { recursive: true });
      const address = runCli(sb, ['wallet', 'address'], randomCwd).trim();
      assert.match(address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    } finally {
      rmSync(sb.root, { recursive: true, force: true });
    }
  });

  test('init refuses to clobber existing user config unless --force is explicit', () => {
    const sb = makeSandbox();
    try {
      runCli(sb, ['init', '--force']);
      const configPath = join(sb.xdgConfigHome, 'lpcli', 'config.json');
      const original = readFileSync(configPath, 'utf-8');

      try {
        runCli(sb, ['init']);
        assert.fail('init without --force should fail when config exists');
      } catch (err: unknown) {
        const stderr = (err as { stderr?: Buffer | string }).stderr?.toString() ?? '';
        const message = err instanceof Error ? err.message : String(err);
        assert.match(`${message}\n${stderr}`, /already exists|--force/);
      }
      assert.strictEqual(readFileSync(configPath, 'utf-8'), original, 'config should remain unchanged');

      runCli(sb, ['init', '--funding-token', 'SOL', '--force']);
      const config = readUserConfig(sb);
      assert.deepStrictEqual(config.fundingToken, {
        mint: 'So11111111111111111111111111111111111111112',
        symbol: 'SOL',
        decimals: 9,
      });
      assert.strictEqual(config.feeReserveSol, 0.08);
    } finally {
      rmSync(sb.root, { recursive: true, force: true });
    }
  });

  test('--config-dir remains supported for explicit isolated config writes', () => {
    const sb = makeSandbox();
    try {
      const explicitConfigDir = join(sb.root, 'explicit-config');
      runCli(sb, ['init', '--config-dir', explicitConfigDir, '--rpc', DEFAULT_RPC, '--cluster', 'devnet', '--force']);

      const config = JSON.parse(readFileSync(join(explicitConfigDir, 'config.json'), 'utf-8')) as Record<string, unknown>;
      assert.strictEqual(config.cluster, 'devnet');
      assert.strictEqual(config.feeReserveSol, 0.08);
      assert.ok(!('rpcUrl' in config), 'explicit config also keeps RPC in .env');
      assert.match(readFileSync(join(explicitConfigDir, '.env'), 'utf-8'), new RegExp(`^RPC_URL=${DEFAULT_RPC}$`, 'm'));
      assert.ok(!existsSync(join(sb.xdgConfigHome, 'lpcli', 'config.json')), 'explicit --config-dir should not also write XDG config');
    } finally {
      rmSync(sb.root, { recursive: true, force: true });
    }
  });
});
