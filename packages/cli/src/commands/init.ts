/**
 * `lpcli init` — interactive first-time setup.
 *
 * Detects existing wallets, creates one if needed, and writes
 * ~/.lpcli/config.json.
 */

import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { CONFIG_PATH } from '../config.js';

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
// OWS detection helpers
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
    // Each wallet block contains "Name:    <name>"
    return output.includes(`Name:    ${name}`) || output.includes(`Name: ${name}`);
  } catch {
    return false;
  }
}

function getOWSWalletAddress(name: string): string | null {
  try {
    const output = execSync(`ows wallet list`, { encoding: 'utf-8' });
    // Parse Solana address from line like:
    //   solana:5eykt... (solana) → <ADDRESS>
    const match = output.match(/solana:[^\s]+\s+\(solana\)\s+→\s+([1-9A-HJ-NP-Za-km-z]{32,44})/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Keypair file detection
// ---------------------------------------------------------------------------

const DEFAULT_KEYPAIR_PATH = join(homedir(), '.config', 'solana', 'id.json');

function keypairFileExists(path: string): boolean {
  return existsSync(path);
}

// ---------------------------------------------------------------------------
// Config write
// ---------------------------------------------------------------------------

function saveConfig(config: object): void {
  const dir = join(homedir(), '.lpcli');
  mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Main init command
// ---------------------------------------------------------------------------

export async function runInit(): Promise<void> {
  const rl = createRL();

  console.log('\nChecking for existing wallet...');

  // ── 1. Check OWS ─────────────────────────────────────────────────────────
  const ows = owsInstalled();
  const defaultOWSName = 'lpcli';
  let owsFound = false;
  let owsAddress: string | null = null;

  if (ows) {
    owsFound = findOWSWallet(defaultOWSName);
    if (owsFound) {
      owsAddress = getOWSWalletAddress(defaultOWSName);
      console.log(`  OWS wallet "${defaultOWSName}" found`);
      if (owsAddress) console.log(`  Address: ${owsAddress}`);
    } else {
      console.log(`  No OWS wallet "${defaultOWSName}" found`);
    }
  } else {
    console.log('  OWS not installed (skipping)');
  }

  // ── 2. Check keypair file ─────────────────────────────────────────────────
  const keypairExists = keypairFileExists(DEFAULT_KEYPAIR_PATH);
  if (keypairExists) {
    console.log(`  Keypair file found: ${DEFAULT_KEYPAIR_PATH}`);
  } else {
    console.log(`  No keypair file at ${DEFAULT_KEYPAIR_PATH}`);
  }

  // ── 3. If a wallet already exists, confirm and skip setup ─────────────────
  let walletBackend: 'ows' | 'keypair' = 'keypair';
  let owsWalletName: string | undefined;
  let privateKey: string | undefined;

  if (owsFound && owsAddress) {
    const confirm = await ask(
      rl,
      `\nOWS wallet "${defaultOWSName}" is already set up (${owsAddress}). Use it? [Y/n] `
    );
    if (confirm === '' || confirm.toLowerCase() === 'y') {
      walletBackend = 'ows';
      owsWalletName = defaultOWSName;
    }
  }

  // ── 4. Interactive wallet setup if not confirmed above ────────────────────
  if (walletBackend !== 'ows' || !owsWalletName) {
    console.log('\nHow would you like to set up your wallet?');
    const options: string[] = [];
    if (ows) {
      options.push('  1. Create new OWS wallet (recommended)');
      options.push('  2. Import existing OWS wallet (mnemonic)');
      options.push('  3. Use existing keypair file');
    } else {
      // OWS not installed — offer to auto-install it
      options.push('  1. Create new OWS wallet (will install OWS automatically)');
      options.push('  2. Use existing keypair file');
    }
    console.log(options.join('\n'));

    const maxOption = ows ? 3 : 2;
    const choice = await ask(rl, `\n> `);
    const choiceNum = parseInt(choice, 10);

    if (!ows && choiceNum === 1) {
      // User picked OWS but it is not installed — auto-install it
      console.log('\nOWS not installed. Installing now...');
      let installOk = false;
      try {
        execSync('npm install -g @open-wallet-standard/core', { stdio: 'inherit' });
        console.log('  OWS installed');
        installOk = true;
      } catch (installErr) {
        console.error(
          '  Failed to install OWS:',
          installErr instanceof Error ? installErr.message : String(installErr)
        );
        console.log('  Falling back to keypair file setup.');
      }

      if (installOk) {
        // Now create the wallet with the freshly installed OWS
        console.log(`\nCreating OWS wallet "${defaultOWSName}"...`);
        try {
          execSync(`ows wallet create --name "${defaultOWSName}"`, { stdio: 'inherit' });
          owsAddress = getOWSWalletAddress(defaultOWSName);
          walletBackend = 'ows';
          owsWalletName = defaultOWSName;
          if (owsAddress) {
            console.log(`  Address: ${owsAddress}`);
          }
        } catch (err) {
          console.error('  Failed to create OWS wallet:', err instanceof Error ? err.message : String(err));
          console.log('  Falling back to keypair file setup.');
        }
      }
    } else if (ows && choiceNum === 1) {
      // Create new OWS wallet (OWS already installed)
      console.log(`\nCreating OWS wallet "${defaultOWSName}"...`);
      try {
        execSync(`ows wallet create --name "${defaultOWSName}"`, { stdio: 'inherit' });
        owsAddress = getOWSWalletAddress(defaultOWSName);
        walletBackend = 'ows';
        owsWalletName = defaultOWSName;
        if (owsAddress) {
          console.log(`  Address: ${owsAddress}`);
        }
      } catch (err) {
        console.error('  Failed to create OWS wallet:', err instanceof Error ? err.message : String(err));
        console.log('  Falling back to keypair file setup.');
      }
    } else if (ows && choiceNum === 2) {
      // Import mnemonic into OWS
      console.log(`\nImporting mnemonic into OWS wallet "${defaultOWSName}"...`);
      const mnemonic = await ask(rl, 'Enter your mnemonic phrase: ');
      try {
        execSync(`ows wallet import --name "${defaultOWSName}" --mnemonic "${mnemonic}"`, { stdio: 'inherit' });
        owsAddress = getOWSWalletAddress(defaultOWSName);
        walletBackend = 'ows';
        owsWalletName = defaultOWSName;
        if (owsAddress) {
          console.log(`  Address: ${owsAddress}`);
        }
      } catch (err) {
        console.error('  Failed to import mnemonic:', err instanceof Error ? err.message : String(err));
        console.log('  Falling back to keypair file setup.');
      }
    }

    // Keypair file path (choice 3 if OWS present, choice 2 if not, or fallback from failed OWS setup)
    if (walletBackend !== 'ows') {
      const defaultPath = keypairExists ? DEFAULT_KEYPAIR_PATH : '';
      const prompt = defaultPath
        ? `\nKeypair file path [${defaultPath}]: `
        : '\nKeypair file path (e.g. ~/.config/solana/id.json): ';
      const input = await ask(rl, prompt);
      const resolvedPath = input !== '' ? input : defaultPath;

      if (!resolvedPath) {
        console.error('\nNo keypair path provided. Exiting.');
        rl.close();
        process.exit(1);
      }

      const expandedPath = resolvedPath.startsWith('~')
        ? resolvedPath.replace('~', homedir())
        : resolvedPath;

      if (!existsSync(expandedPath)) {
        console.error(`\nKeypair file not found: ${expandedPath}`);
        rl.close();
        process.exit(1);
      }

      walletBackend = 'keypair';
      privateKey = resolvedPath; // store as-is (may include ~)
    }
  }

  // ── 5. Ask for Helius RPC URL ─────────────────────────────────────────────
  const defaultRpc = 'https://api.mainnet-beta.solana.com';
  const rpcInput = await ask(
    rl,
    `\nEnter your Helius RPC URL (press enter for public RPC):\n> `
  );
  const rpcUrl = rpcInput !== '' ? rpcInput : defaultRpc;

  // ── 6. Save config ────────────────────────────────────────────────────────
  const config: Record<string, unknown> = {
    rpcUrl,
    cluster: 'mainnet',
    walletBackend,
  };

  if (walletBackend === 'ows' && owsWalletName) {
    config['owsWalletName'] = owsWalletName;
  }
  if (walletBackend === 'keypair' && privateKey) {
    config['privateKey'] = privateKey;
  }

  saveConfig(config);

  // ── 7. Link lpcli globally so `lpcli` works from anywhere ────────────────
  try {
    const pkgDir = new URL('../../..', import.meta.url).pathname;
    execSync('npm link', { cwd: pkgDir, stdio: 'ignore' });
  } catch {
    // Non-fatal — user can link manually
  }

  console.log(`\nConfig saved to ${CONFIG_PATH}`);
  if (owsAddress) {
    console.log(`  Address: ${owsAddress}`);
  }
  console.log("  Ready. Run `lpcli discover SOL` to get started.");
  console.log('');

  rl.close();
}
