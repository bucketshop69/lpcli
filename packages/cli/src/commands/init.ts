/**
 * `lpcli init` — first-time setup.
 *
 * Interactive (human):
 *   lpcli init
 *
 * Non-interactive (agent):
 *   lpcli init --rpc https://... --funding-token USDC --force
 *   lpcli init --force                              # defaults: public RPC, USDC
 *
 * Wallet is always named "lpcli" — multi-wallet support will come later.
 *
 * OWS-only — no keypair file fallback.
 */

import { createInterface } from 'node:readline';
import { chmodSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { DEFAULT_FEE_RESERVE_SOL } from '@lpcli/core';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WALLET_NAME = 'lpcli';
const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';

const FUNDING_TOKENS = {
  USDC: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 },
  SOL:  { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', decimals: 9 },
} as const;

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function getFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

// ---------------------------------------------------------------------------
// Readline helper
// ---------------------------------------------------------------------------

function createRL() {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: ReturnType<typeof createRL>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

// ---------------------------------------------------------------------------
// OWS helpers
// ---------------------------------------------------------------------------

function owsInstalled(): boolean {
  try {
    execSync('ows --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function findOWSWallet(name: string): boolean {
  try {
    const output = execSync(`ows wallet list`, { encoding: 'utf-8' });
    return output.includes(`Name:    ${name}`) || output.includes(`Name: ${name}`);
  } catch {
    return false;
  }
}

/**
 * Get the Solana address for a specific OWS wallet by name.
 * Parses the `ows wallet list` output block-by-block to find the right wallet.
 */
function getOWSWalletAddress(name: string): string | null {
  try {
    const output = execSync(`ows wallet list`, { encoding: 'utf-8' });

    // Split into wallet blocks (separated by blank lines or "ID:" lines)
    const blocks = output.split(/\n(?=ID:)/);

    for (const block of blocks) {
      // Check if this block is for the wallet we want
      const nameMatch = block.match(/Name:\s+(\S+)/);
      if (!nameMatch || nameMatch[1] !== name) continue;

      // Extract Solana address from this block
      const solanaMatch = block.match(/solana:[^\s]+\s+\(solana\)\s+→\s+([1-9A-HJ-NP-Za-km-z]{32,44})/);
      if (solanaMatch) return solanaMatch[1];
    }

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Funding token resolution
// ---------------------------------------------------------------------------

function resolveFundingToken(symbol: string): { mint: string; symbol: string; decimals: number } {
  const upper = symbol.toUpperCase();
  if (upper === 'SOL') return { ...FUNDING_TOKENS.SOL };
  return { ...FUNDING_TOKENS.USDC };
}

// ---------------------------------------------------------------------------
// Config + .env write
// ---------------------------------------------------------------------------

function getUserConfigDir(): string {
  return resolve(process.env['XDG_CONFIG_HOME'] ?? resolve(process.env['HOME'] ?? process.cwd(), '.config'), 'lpcli');
}

function saveConfig(configPath: string, config: object): void {
  mkdirSync(resolve(configPath, '..'), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
}

/**
 * Write or update a key in the .env file next to config.json.
 * Preserves existing entries.
 */
function saveEnvVar(configDir: string, key: string, value: string): void {
  mkdirSync(configDir, { recursive: true });
  const envPath = resolve(configDir, '.env');
  let lines: string[] = [];

  if (existsSync(envPath)) {
    lines = readFileSync(envPath, 'utf-8').split('\n');
    // Remove existing line for this key
    lines = lines.filter((l) => !l.startsWith(`${key}=`));
  }

  lines.push(`${key}=${value}`);

  // Remove trailing blank lines, then add final newline
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  writeFileSync(envPath, lines.join('\n') + '\n', { encoding: 'utf-8', mode: 0o600 });
  chmodSync(envPath, 0o600);
}

// ---------------------------------------------------------------------------
// Ensure OWS + wallet exist
// ---------------------------------------------------------------------------

function ensureOWSWallet(): string | null {
  if (!owsInstalled()) {
    console.log('Installing OWS...');
    try {
      execSync('npm install -g @open-wallet-standard/core', { stdio: 'inherit' });
    } catch (err) {
      console.error('Failed to install OWS:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  if (!findOWSWallet(WALLET_NAME)) {
    console.log(`Creating OWS wallet "${WALLET_NAME}"...`);
    try {
      execSync(`ows wallet create --name "${WALLET_NAME}"`, { stdio: 'inherit' });
    } catch (err) {
      console.error('Failed to create OWS wallet:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  return getOWSWalletAddress(WALLET_NAME);
}

// ---------------------------------------------------------------------------
// Non-interactive init (for agents)
// ---------------------------------------------------------------------------

async function runNonInteractive(args: string[]): Promise<void> {
  const rpcUrl = getFlag(args, '--rpc');
  const fundingSymbol = getFlag(args, '--funding-token') ?? 'USDC';
  const cluster = (getFlag(args, '--cluster') ?? 'mainnet') as 'mainnet' | 'devnet';
  const configDir = getFlag(args, '--config-dir') ?? getUserConfigDir();
  const configPath = resolve(configDir, 'config.json');
  const force = hasFlag(args, '--force');

  if (existsSync(configPath) && !force) {
    console.error(`config.json already exists at ${configPath}. Use --force to overwrite.`);
    process.exit(1);
  }

  const address = ensureOWSWallet();
  const fundingToken = resolveFundingToken(fundingSymbol);

  const config = { wallet: WALLET_NAME, cluster, fundingToken, feeReserveSol: DEFAULT_FEE_RESERVE_SOL };
  saveConfig(configPath, config);

  // RPC URL always goes to .env (keeps API keys out of config.json)
  saveEnvVar(configDir, 'RPC_URL', rpcUrl ?? DEFAULT_RPC);
  console.log(`RPC URL saved to .env`);

  console.log(`Config saved to ${configPath}`);
  if (address) console.log(`  Wallet: ${WALLET_NAME} (${address})`);
  console.log(`  Cluster: ${cluster}`);
  console.log(`  Funding token: ${fundingToken.symbol}`);
}

// ---------------------------------------------------------------------------
// Interactive init (for humans)
// ---------------------------------------------------------------------------

async function runInteractive(): Promise<void> {
  const rl = createRL();
  const configPath = resolve(getUserConfigDir(), 'config.json');

  console.log('\nChecking for OWS wallet...');

  const ows = owsInstalled();
  let owsAddress: string | null = null;

  if (ows && findOWSWallet(WALLET_NAME)) {
    owsAddress = getOWSWalletAddress(WALLET_NAME);
    console.log(`  OWS wallet "${WALLET_NAME}" found`);
    if (owsAddress) console.log(`  Address: ${owsAddress}`);
  } else {
    owsAddress = ensureOWSWallet();
  }

  // RPC — saved to .env, not config.json
  const rpcInput = await ask(rl, `\nRPC URL (saved to .env, press enter for public Solana RPC):\n> `);
  const rpcUrl = rpcInput || DEFAULT_RPC;

  // Funding token — explain + numbered choice
  console.log(`
Funding token is the token lpcli uses as your "home base" currency.
When you open a position, lpcli auto-swaps from this token into the pool.
When you close, it swaps back. Choose one:

  1. USDC (recommended)
  2. SOL`);

  let fundingToken: { mint: string; symbol: string; decimals: number };
  const fundingChoice = await ask(rl, `\n> `);
  if (fundingChoice === '2' || fundingChoice.toUpperCase() === 'SOL') {
    fundingToken = resolveFundingToken('SOL');
  } else {
    fundingToken = resolveFundingToken('USDC');
  }

  const config = {
    wallet: WALLET_NAME,
    cluster: 'mainnet' as const,
    fundingToken,
    feeReserveSol: DEFAULT_FEE_RESERVE_SOL,
  };

  if (existsSync(configPath)) {
    const overwrite = await ask(rl, `\nconfig.json already exists. Overwrite? [y/N] `);
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Aborted.');
      rl.close();
      return;
    }
  }

  saveConfig(configPath, config);

  // RPC URL always → .env (keeps API keys out of version control)
  const configDir = resolve(configPath, '..');
  saveEnvVar(configDir, 'RPC_URL', rpcUrl);

  console.log(`\nConfig saved to ${configPath}`);
  if (owsAddress) console.log(`  Wallet: ${WALLET_NAME} (${owsAddress})`);
  console.log(`  RPC: ${rpcUrl} (in .env)`);
  console.log(`  Funding token: ${fundingToken.symbol}`);
  console.log("  Ready. Run `lpcli discover SOL` to get started.\n");

  rl.close();
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export async function runInit(args: string[] = []): Promise<void> {
  // Non-interactive if any flags are provided
  const isNonInteractive =
    hasFlag(args, '--force') ||
    hasFlag(args, '--config-dir') ||
    hasFlag(args, '--rpc') ||
    hasFlag(args, '--funding-token') ||
    hasFlag(args, '--cluster');

  if (isNonInteractive) {
    await runNonInteractive(args);
  } else {
    await runInteractive();
  }
}
