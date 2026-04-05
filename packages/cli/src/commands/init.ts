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
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WALLET_NAME = 'lpcli';

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

function getOWSWalletAddress(name: string): string | null {
  try {
    const output = execSync(`ows wallet list`, { encoding: 'utf-8' });
    const match = output.match(/solana:[^\s]+\s+\(solana\)\s+→\s+([1-9A-HJ-NP-Za-km-z]{32,44})/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Funding token resolution
// ---------------------------------------------------------------------------

function resolveFundingToken(symbol: string): { mint: string; symbol: string; decimals: number } {
  const upper = symbol.toUpperCase();
  if (upper === 'SOL') {
    return { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', decimals: 9 };
  }
  // Default to USDC
  return { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 };
}

// ---------------------------------------------------------------------------
// Config write
// ---------------------------------------------------------------------------

function saveConfig(configPath: string, config: object): void {
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
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
  const rpcUrl = getFlag(args, '--rpc') ?? '';
  const fundingSymbol = getFlag(args, '--funding-token') ?? 'USDC';
  const cluster = (getFlag(args, '--cluster') ?? 'mainnet') as 'mainnet' | 'devnet';
  const configDir = getFlag(args, '--config-dir') ?? process.cwd();
  const configPath = resolve(configDir, 'config.json');
  const force = hasFlag(args, '--force');

  if (existsSync(configPath) && !force) {
    console.error(`config.json already exists at ${configPath}. Use --force to overwrite.`);
    process.exit(1);
  }

  const address = ensureOWSWallet();
  const fundingToken = resolveFundingToken(fundingSymbol);

  const config = { wallet: WALLET_NAME, cluster, rpcUrl, fundingToken };
  saveConfig(configPath, config);

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
  const configPath = resolve(process.cwd(), 'config.json');

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

  // RPC
  const rpcInput = await ask(rl, `\nEnter your Helius RPC URL (press enter for public RPC):\n> `);
  const rpcUrl = rpcInput || '';

  // Funding token
  const fundingInput = await ask(rl, `\nFunding token [USDC]: `);
  const fundingToken = resolveFundingToken(fundingInput || 'USDC');

  const config = {
    wallet: WALLET_NAME,
    cluster: 'mainnet' as const,
    rpcUrl,
    fundingToken,
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

  console.log(`\nConfig saved to ${configPath}`);
  if (owsAddress) console.log(`  Wallet: ${WALLET_NAME} (${owsAddress})`);
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
