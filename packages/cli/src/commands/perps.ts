/**
 * `lpcli perps` — Pacifica perpetuals operations.
 *
 * Usage:
 *   lpcli perps balance                             Show Pacifica account balance
 *   lpcli perps deposit <amount>  [--yes]           Deposit USDC to Pacifica
 *   lpcli perps withdraw <amount> [--yes]           Withdraw USDC from Pacifica
 */

import { createInterface } from 'node:readline';
import {
  LPCLI,
  PacificaClient,
  buildDepositTransaction,
  requestWithdrawal,
  PACIFICA_MIN_DEPOSIT_USDC,
} from '@lpcli/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

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
// Subcommands
// ---------------------------------------------------------------------------

async function showBalance(): Promise<void> {
  const lpcli = new LPCLI();
  const wallet = await lpcli.getWallet();
  const address = wallet.getPublicKey().toBase58();
  const client = new PacificaClient();

  try {
    const info = await client.getAccountInfo(address);

    console.log(`\nPacifica Account: ${address}`);
    console.log('─'.repeat(50));
    console.log(`  Balance:            $${parseFloat(info.balance).toFixed(2)}`);
    console.log(`  Account Equity:     $${parseFloat(info.account_equity).toFixed(2)}`);
    console.log(`  Available to Spend: $${parseFloat(info.available_to_spend).toFixed(2)}`);
    console.log(`  Available to Withdraw: $${parseFloat(info.available_to_withdraw).toFixed(2)}`);
    console.log(`  Margin Used:        $${parseFloat(info.total_margin_used).toFixed(2)}`);
    const utilization = parseFloat(info.account_equity) > 0
      ? (parseFloat(info.total_margin_used) / parseFloat(info.account_equity) * 100).toFixed(1)
      : '0.0';
    console.log(`  Margin Utilization: ${utilization}%`);
    console.log(`  Positions:          ${info.positions_count}`);
    console.log(`  Open Orders:        ${info.orders_count + info.stop_orders_count}`);
    console.log('');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
      console.log(`\nPacifica Account: ${address}`);
      console.log('  No account found. Deposit USDC to create your account.');
      console.log('  Usage: lpcli perps deposit <amount>\n');
    } else {
      throw err;
    }
  }
}

async function runDeposit(args: string[]): Promise<void> {
  const amountRaw = args[0];
  const autoConfirm = hasFlag(args, '--yes');

  if (!amountRaw) {
    console.error('Usage: lpcli perps deposit <amount> [--yes]');
    console.error('  amount: USDC amount to deposit (e.g. 10, 50.5)');
    process.exit(1);
  }

  const amount = parseFloat(amountRaw);
  if (isNaN(amount) || amount < PACIFICA_MIN_DEPOSIT_USDC) {
    console.error(`Minimum deposit is $${PACIFICA_MIN_DEPOSIT_USDC} USDC (Pacifica requirement).`);
    process.exit(1);
  }

  const lpcli = new LPCLI();
  const wallet = await lpcli.getWallet();
  const connection = wallet.getConnection();
  const pubkey = wallet.getPublicKey();

  // Check USDC balance
  const usdcBal = await wallet.getTokenBalance('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  const available = usdcBal?.uiAmount ?? 0;

  if (available < amount) {
    console.error(`\nInsufficient USDC. Have: $${available.toFixed(2)}, Need: $${amount.toFixed(2)}`);
    process.exit(1);
  }

  console.log(`\nDeposit to Pacifica:`);
  console.log(`  Wallet: ${pubkey.toBase58()}`);
  console.log(`  Amount: $${amount.toFixed(2)} USDC`);
  console.log(`  USDC Balance: $${available.toFixed(2)}`);
  console.log('');

  if (!autoConfirm) {
    const confirm = await ask('Confirm deposit? [y/N] ');
    if (confirm.toLowerCase() !== 'y') {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  const tx = await buildDepositTransaction(pubkey, amount, connection);
  const signed = await wallet.signTx(tx);
  const sig = await connection.sendRawTransaction(signed.serialize());
  console.log(`Sent: ${sig}`);
  await connection.confirmTransaction(sig, 'confirmed');
  console.log(`Confirmed! Deposited $${amount.toFixed(2)} USDC to Pacifica.`);
  console.log(`https://solscan.io/tx/${sig}\n`);
}

async function runWithdraw(args: string[]): Promise<void> {
  const amountRaw = args[0];
  const autoConfirm = hasFlag(args, '--yes');

  if (!amountRaw) {
    console.error('Usage: lpcli perps withdraw <amount> [--yes]');
    console.error('  amount: USDC amount to withdraw (e.g. 10, 50.5)');
    process.exit(1);
  }

  const amount = parseFloat(amountRaw);
  if (isNaN(amount) || amount < 1) {
    console.error('Amount must be at least $1 (Pacifica minimum).');
    process.exit(1);
  }

  const lpcli = new LPCLI();
  const wallet = await lpcli.getWallet();
  const address = wallet.getPublicKey().toBase58();
  const client = new PacificaClient();

  // Check available to withdraw
  let availableToWithdraw = 0;
  try {
    const info = await client.getAccountInfo(address);
    availableToWithdraw = parseFloat(info.available_to_withdraw);
  } catch {
    console.error('Could not fetch account info. Is your account registered on Pacifica?');
    process.exit(1);
  }

  if (availableToWithdraw < amount) {
    console.error(`\nInsufficient withdrawal balance. Available: $${availableToWithdraw.toFixed(2)}, Requested: $${amount.toFixed(2)}`);
    process.exit(1);
  }

  console.log(`\nWithdraw from Pacifica:`);
  console.log(`  Wallet: ${address}`);
  console.log(`  Amount: $${amount.toFixed(2)} USDC`);
  console.log(`  Available: $${availableToWithdraw.toFixed(2)}`);
  console.log(`  Fee: $1.00`);
  console.log('');

  if (!autoConfirm) {
    const confirm = await ask('Confirm withdrawal? [y/N] ');
    if (confirm.toLowerCase() !== 'y') {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  await requestWithdrawal(wallet, amount, client);
  console.log(`Withdrawal of $${amount.toFixed(2)} USDC requested.`);
  console.log('Note: Pacifica processes withdrawals to your wallet. Check your balance shortly.\n');
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export async function runPerps(args: string[]): Promise<void> {
  const subcommand = args[0];

  try {
    switch (subcommand) {
      case 'balance':
        await showBalance();
        break;

      case 'deposit':
        await runDeposit(args.slice(1));
        break;

      case 'withdraw':
        await runWithdraw(args.slice(1));
        break;

      case undefined:
      case '--help':
      case '-h':
        console.log(`
lpcli perps — Pacifica perpetuals

Usage:
  lpcli perps balance                Show Pacifica account balance & margin
  lpcli perps deposit <amount>       Deposit USDC to Pacifica
  lpcli perps withdraw <amount>      Withdraw USDC from Pacifica

Options:
  --yes                              Skip confirmation prompt
`);
        break;

      default:
        console.error(`Unknown perps subcommand: ${subcommand}`);
        console.error('Usage: lpcli perps [balance|deposit|withdraw]');
        process.exit(1);
    }
  } catch (err: unknown) {
    console.error('Perps error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
