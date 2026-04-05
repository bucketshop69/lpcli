/**
 * `lpcli wallet` — wallet info and operations.
 *
 * Usage:
 *   lpcli wallet                                  Show address, SOL balance, funding token balance
 *   lpcli wallet address                          Just the base58 address (scriptable)
 *   lpcli wallet balance                          SOL + all SPL token balances
 *   lpcli wallet transfer --to <addr> --amount <n> [--token <mint|SOL>] [--yes]
 *
 * All read commands work non-interactively.
 * Transfer requires --yes for non-interactive confirmation.
 */

import { createInterface } from 'node:readline';
import { LPCLI } from '@lpcli/core';

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

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatSol(lamports: number): string {
  return `${(lamports / 1_000_000_000).toFixed(9)} SOL`;
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function showOverview(): Promise<void> {
  const lpcli = new LPCLI();
  const wallet = await lpcli.getWallet();
  const balances = await wallet.getBalances();
  const funding = lpcli.getFundingToken();

  const fundingBalance = balances.tokens.find((t) => t.mint === funding.mint);

  console.log(`
Wallet:   ${balances.address}
SOL:      ${balances.solBalance.toFixed(9)} SOL (${balances.solLamports} lamports)
${funding.symbol}:    ${fundingBalance ? fundingBalance.uiAmount : 0} ${funding.symbol}
`);
}

async function showAddress(): Promise<void> {
  const lpcli = new LPCLI();
  const wallet = await lpcli.getWallet();
  // Just the address — scriptable, no extra text
  console.log(wallet.getPublicKey().toBase58());
}

async function showBalance(): Promise<void> {
  const lpcli = new LPCLI();
  const wallet = await lpcli.getWallet();
  const balances = await wallet.getBalances();

  console.log(`\nWallet: ${balances.address}`);
  console.log(`SOL:    ${balances.solBalance.toFixed(9)} (${balances.solLamports} lamports)\n`);

  if (balances.tokens.length === 0) {
    console.log('No SPL token balances.\n');
    return;
  }

  console.log('SPL Tokens:');
  for (const t of balances.tokens) {
    console.log(`  ${t.mint}  ${t.uiAmount} (raw: ${t.amount}, decimals: ${t.decimals})`);
  }
  console.log('');
}

async function runTransfer(args: string[]): Promise<void> {
  const to = getFlag(args, '--to');
  const amountRaw = getFlag(args, '--amount');
  const token = getFlag(args, '--token') ?? 'SOL';
  const autoConfirm = hasFlag(args, '--yes');

  if (!to || !amountRaw) {
    console.error('Usage: lpcli wallet transfer --to <address> --amount <n> [--token <mint|SOL>] [--yes]');
    process.exit(1);
  }

  const amount = parseFloat(amountRaw);
  if (isNaN(amount) || amount <= 0) {
    console.error('--amount must be a positive number');
    process.exit(1);
  }

  const isSOL = token.toUpperCase() === 'SOL';

  // Confirmation
  console.log(`\nTransfer:`);
  console.log(`  To:     ${to}`);
  console.log(`  Amount: ${amount} ${isSOL ? 'SOL' : token}`);
  console.log('');

  if (!autoConfirm) {
    const confirm = await ask('Confirm transfer? [y/N] ');
    if (confirm.toLowerCase() !== 'y') {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  const lpcli = new LPCLI();
  const wallet = await lpcli.getWallet();

  if (isSOL) {
    const result = await wallet.transferSOL(to, amount);
    console.log(`\nTransfer sent!`);
    console.log(`  Signature: ${result.signature}`);
    console.log(`  From: ${result.from}`);
    console.log(`  To: ${result.to}`);
    console.log(`  Amount: ${result.amount} SOL\n`);
  } else {
    const result = await wallet.transferToken({ to, mint: token, amount });
    console.log(`\nTransfer sent!`);
    console.log(`  Signature: ${result.signature}`);
    console.log(`  From: ${result.from}`);
    console.log(`  To: ${result.to}`);
    console.log(`  Amount: ${result.amount} (raw)`);
    console.log(`  Token: ${result.token}\n`);
  }
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export async function runWallet(args: string[]): Promise<void> {
  const subcommand = args[0];

  try {
    switch (subcommand) {
      case 'address':
        await showAddress();
        break;

      case 'balance':
        await showBalance();
        break;

      case 'transfer':
        await runTransfer(args.slice(1));
        break;

      case undefined:
        await showOverview();
        break;

      default:
        console.error(`Unknown wallet subcommand: ${subcommand}`);
        console.error('Usage: lpcli wallet [address|balance|transfer]');
        process.exit(1);
    }
  } catch (err: unknown) {
    console.error('Wallet error:', err instanceof Error ? err.message : String(err));
    console.error('Run `lpcli init` to set up your wallet.');
    process.exit(1);
  }
}
