/**
 * `lpcli close <position>` — close a position and swap back to funding token.
 *
 * Usage:
 *   lpcli close <position_address> --pool <pool_address>
 *     Closes the position, withdraws all liquidity + claims fees,
 *     then swaps all proceeds back to the funding token.
 *     SOL fee reserve (0.02 SOL) is kept for future transactions.
 *
 *   lpcli close <position_address> --pool <pool_address> --no-swap
 *     Close without swapping back (tokens stay as-is in wallet).
 */

import { createInterface } from 'node:readline';
import { LPCLI } from '@lpcli/core';
import type { FundedCloseResult, ClosePositionResult } from '@lpcli/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function createRL() {
  return createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl: ReturnType<typeof createRL>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

// ---------------------------------------------------------------------------
// Command entrypoint
// ---------------------------------------------------------------------------

export async function runClose(args: string[]): Promise<void> {
  const positionAddress = args[0];
  if (!positionAddress) {
    console.error('Usage: lpcli close <position_address> --pool <pool_address> [--no-swap]');
    process.exit(1);
  }

  const pool = getFlag(args, '--pool');
  if (!pool) {
    console.error('--pool <pool_address> is required to resolve token mints for swap-back.');
    process.exit(1);
  }

  const noSwap = hasFlag(args, '--no-swap');

  const lpcli = new LPCLI();
  try {
    await lpcli.getWallet();
  } catch (err: unknown) {
    console.error('Wallet error:', err instanceof Error ? err.message : String(err));
    console.error('Run `lpcli init` to set up your wallet.');
    process.exit(1);
  }

  const funding = lpcli.getFundingToken();

  // Confirmation prompt
  const rl = createRL();
  console.log(`
Close position: ${positionAddress}
  Pool:           ${pool}
  Swap back to:   ${noSwap ? '(none — tokens stay in wallet)' : `${funding.symbol} (${funding.mint.slice(0, 8)}...)`}
  SOL fee reserve: ${lpcli.config.feeReserveSol} SOL (kept for future txs)

  This will withdraw all liquidity and claim all fees.
`);

  const confirm = await ask(rl, 'Confirm? [y/N] ');
  rl.close();

  if (confirm.toLowerCase() !== 'y') {
    console.log('Aborted.');
    process.exit(0);
  }

  // ── No-swap mode: just close ───────────────────────────────────────────

  if (noSwap) {
    console.log('\nClosing position...');

    let result: ClosePositionResult;
    try {
      result = await lpcli.dlmm!.closePosition(positionAddress);
    } catch (err: unknown) {
      console.error('Failed to close position:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    console.log(`
Position closed successfully!

  Withdrawn X:    ${result.withdrawn_x}
  Withdrawn Y:    ${result.withdrawn_y}
  Claimed fees X: ${result.claimed_fees_x}
  Claimed fees Y: ${result.claimed_fees_y}
  TX:             ${result.tx}
`);
    return;
  }

  // ── Funded mode: close + swap back ─────────────────────────────────────

  console.log('\nClosing position & swapping back...');

  let result: FundedCloseResult;
  try {
    result = await lpcli.closeToFunding(positionAddress, pool);
  } catch (err: unknown) {
    console.error('Failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  console.log(`
Position closed successfully!

  Withdrawn X:    ${result.close.withdrawn_x}
  Withdrawn Y:    ${result.close.withdrawn_y}
  Claimed fees X: ${result.close.claimed_fees_x}
  Claimed fees Y: ${result.close.claimed_fees_y}
  Close TX:       ${result.close.tx}
  Swap-back:      ${result.swaps.length} swap(s) executed
`);

  for (const swap of result.swaps) {
    console.log(`    ${swap.inAmount} → ${swap.outAmount} (sig: ${swap.signature})`);
  }

  console.log();
}
