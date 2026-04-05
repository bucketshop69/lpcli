/**
 * `lpcli init` — first-time setup.
 *
 * Interactive (human):
 *   lpcli init
 *
 * Non-interactive (agent):
 *   lpcli init --wallet my-agent --rpc https://... --funding-token USDC
 *   lpcli init --wallet my-agent                  # defaults: public RPC, USDC
 *
 * Detects existing OWS wallets, creates one if needed, and writes
 * config.json to the project root (cwd or --config-dir).
 *
 * OWS-only — no keypair file fallback.
 */

import { createInterface } from 'node:readline';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

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
// Non-interactive init (for agents)
// ---------------------------------------------------------------------------

async function runNonInteractive(args: string[]): Promise<void> {
  const walletName = getFlag(args, '--wallet') ?? 'lpcli';
  const rpcUrl = getFlag(args, '--rpc') ?? '';
  const fundingSymbol = getFlag(args, '--funding-token') ?? 'USDC';
  const cluster = (getFlag(args, '--cluster') ?? 'mainnet') as 'mainnet' | 'devnet';
  const configDir = getFlag(args, '--config-dir') ?? process.cwd();
  const configPath = resolve(configDir, 'config.json');
  const force = hasFlag(args, '--force');

  // Check config exists
  if (existsSync(configPath) && !force) {
    console.error(`config.json already exists at ${configPath}. Use --force to overwrite.`);
    process.exit(1);
  }

  // Ensure OWS is installed
  if (!owsInstalled()) {
    console.log('Installing OWS...');
    try {
      execSync('npm install -g @open-wallet-standard/core', { stdio: 'inherit' });
    } catch (err) {
      console.error('Failed to install OWS:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  // Create wallet if it doesn't exist
  if (!findOWSWallet(walletName)) {
    console.log(`Creating OWS wallet "${walletName}"...`);
    try {
      execSync(`ows wallet create --name "${walletName}"`, { stdio: 'inherit' });
    } catch (err) {
      console.error('Failed to create OWS wallet:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  const address = getOWSWalletAddress(walletName);
  const fundingToken = resolveFundingToken(fundingSymbol);

  const config = { wallet: walletName, cluster, rpcUrl, fundingToken };
  saveConfig(configPath, config);

  console.log(`Config saved to ${configPath}`);
  if (address) console.log(`  Wallet: ${walletName} (${address})`);
  console.log(`  Cluster: ${cluster}`);
  console.log(`  Funding token: ${fundingToken.symbol}`);
}

// ---------------------------------------------------------------------------
// Interactive init (for humans)
// ---------------------------------------------------------------------------

async function runInteractive(): Promise<void> {
  const rl = createRL();
  const defaultWalletName = 'lpcli';
  const configPath = resolve(process.cwd(), 'config.json');

  console.log('\nChecking for OWS wallet...');

  let ows = owsInstalled();
  let owsFound = false;
  let owsAddress: string | null = null;
  let walletName = defaultWalletName;

  if (ows) {
    owsFound = findOWSWallet(defaultWalletName);
    if (owsFound) {
      owsAddress = getOWSWalletAddress(defaultWalletName);
      console.log(`  OWS wallet "${defaultWalletName}" found`);
      if (owsAddress) console.log(`  Address: ${owsAddress}`);
    } else {
      console.log(`  No OWS wallet "${defaultWalletName}" found`);
    }
  } else {
    console.log('  OWS not installed');
  }

  if (owsFound && owsAddress) {
    const confirm = await ask(
      rl,
      `\nUse existing OWS wallet "${defaultWalletName}" (${owsAddress})? [Y/n] `
    );
    if (confirm !== '' && confirm.toLowerCase() !== 'y') {
      owsFound = false;
    }
  }

  if (!owsFound) {
    if (!ows) {
      console.log('\nInstalling OWS...');
      try {
        execSync('npm install -g @open-wallet-standard/core', { stdio: 'inherit' });
        ows = true;
        console.log('  OWS installed');
      } catch (err) {
        console.error('  Failed to install OWS:', err instanceof Error ? err.message : String(err));
        console.error('\nOWS is required. Install manually: npm install -g @open-wallet-standard/core');
        rl.close();
        process.exit(1);
      }
    }

    const nameInput = await ask(rl, `\nWallet name [${defaultWalletName}]: `);
    walletName = nameInput || defaultWalletName;

    console.log(`\nCreating OWS wallet "${walletName}"...`);
    try {
      execSync(`ows wallet create --name "${walletName}"`, { stdio: 'inherit' });
      owsAddress = getOWSWalletAddress(walletName);
      if (owsAddress) console.log(`  Address: ${owsAddress}`);
    } catch (err) {
      console.error('  Failed to create OWS wallet:', err instanceof Error ? err.message : String(err));
      rl.close();
      process.exit(1);
    }
  }

  const rpcInput = await ask(rl, `\nEnter your Helius RPC URL (press enter for public RPC):\n> `);
  const rpcUrl = rpcInput || '';

  const fundingInput = await ask(rl, `\nFunding token [USDC]: `);
  const fundingToken = resolveFundingToken(fundingInput || 'USDC');

  const config = {
    wallet: walletName,
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
  if (owsAddress) console.log(`  Wallet: ${walletName} (${owsAddress})`);
  console.log(`  Funding token: ${fundingToken.symbol}`);
  console.log("  Ready. Run `lpcli discover SOL` to get started.\n");

  rl.close();
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export async function runInit(args: string[] = []): Promise<void> {
  // If --wallet flag is provided, run non-interactive mode
  const isNonInteractive = hasFlag(args, '--wallet') || hasFlag(args, '--force');

  if (isNonInteractive) {
    await runNonInteractive(args);
  } else {
    await runInteractive();
  }
}
