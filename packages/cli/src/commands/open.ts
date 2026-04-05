/**
 * `lpcli open <pool>` — open a new liquidity position.
 *
 * Usage:
 *   lpcli open <pool_address> --amount 5 [--strategy spot|bidask|curve] [--bins N]
 *   lpcli open <pool_address> --amount-x 2 --amount-y 150 --strategy bidask
 *
 * Requires wallet config. Shows confirmation prompt before sending.
 */

import { createInterface } from 'node:readline';
import { LPCLI, type OpenPositionResult } from '@lpcli/core';

// ---------------------------------------------------------------------------
// Arg parsing helpers
// ---------------------------------------------------------------------------

function getFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

// ---------------------------------------------------------------------------
// Readline confirm prompt — same pattern as init.ts
// ---------------------------------------------------------------------------

function createRL() {
  return createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl: ReturnType<typeof createRL>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

// ---------------------------------------------------------------------------
// Lamport conversion: 1 SOL = 1e9 lamports
// ---------------------------------------------------------------------------
const LAMPORTS_PER_SOL = 1_000_000_000;

// ---------------------------------------------------------------------------
// Command entrypoint
// ---------------------------------------------------------------------------

export async function runOpen(args: string[]): Promise<void> {
  const pool = args[0];
  if (!pool) {
    console.error('Usage: lpcli open <pool_address> --amount <sol> [--strategy spot|bidask|curve] [--bins N]');
    process.exit(1);
  }

  // Parse amounts — --amount is SOL shorthand (converted to lamports for X)
  const amountSol  = getFlag(args, '--amount');
  const amountXRaw = getFlag(args, '--amount-x');
  const amountYRaw = getFlag(args, '--amount-y');
  const strategyRaw = getFlag(args, '--strategy') ?? 'spot';
  const binsRaw = getFlag(args, '--bins');

  const validStrategies = ['spot', 'bidask', 'curve'] as const;
  type Strategy = typeof validStrategies[number];
  if (!validStrategies.includes(strategyRaw as Strategy)) {
    console.error(`--strategy must be one of: ${validStrategies.join(', ')}`);
    process.exit(1);
  }
  const strategy = strategyRaw as Strategy;

  // amountX is provided in lamports (raw), or convert SOL amount
  let amountX: number | undefined;
  let amountY: number | undefined;

  if (amountSol !== undefined) {
    amountX = Math.round(parseFloat(amountSol) * LAMPORTS_PER_SOL);
  }
  if (amountXRaw !== undefined) {
    amountX = parseFloat(amountXRaw);
  }
  if (amountYRaw !== undefined) {
    amountY = parseFloat(amountYRaw);
  }

  if (amountX === undefined && amountY === undefined) {
    console.error('Provide at least one of: --amount, --amount-x, --amount-y');
    process.exit(1);
  }

  const widthBins = binsRaw ? parseInt(binsRaw, 10) : undefined;

  const lpcli = new LPCLI();
  let wallet;
  try {
    wallet = await lpcli.getWallet();
  } catch (err: unknown) {
    console.error('Wallet error:', err instanceof Error ? err.message : String(err));
    console.error('Run `lpcli init` to set up your wallet.');
    process.exit(1);
  }

  const dlmm = lpcli.dlmm!;

  // Show confirmation prompt
  const rl = createRL();
  console.log(`
Open position on pool ${pool}:
  Strategy:  ${strategy}
  Amount X:  ${amountX !== undefined ? amountX : '—'} lamports${amountSol !== undefined ? ` (${amountSol} SOL)` : ''}
  Amount Y:  ${amountY !== undefined ? amountY : '—'} lamports
  Bin width: ${widthBins !== undefined ? String(widthBins) : 'default (max(10, floor(50/binStep)))'}
`);

  const confirm = await ask(rl, 'Confirm? [y/N] ');
  rl.close();

  if (confirm.toLowerCase() !== 'y') {
    console.log('Aborted.');
    process.exit(0);
  }

  console.log('\nOpening position...');

  let result: OpenPositionResult;
  try {
    result = await dlmm.openPosition({
      pool,
      amountX,
      amountY,
      strategy,
      widthBins,
    });
  } catch (err: unknown) {
    console.error('Failed to open position:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  console.log(`
Position opened successfully!

  Position: ${result.position}
  Range:    ${result.range_low.toFixed(6)} — ${result.range_high.toFixed(6)}
  Deposited X: ${result.deposited_x} lamports
  Deposited Y: ${result.deposited_y} lamports
  TX:       ${result.tx}
`);
}
