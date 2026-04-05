/**
 * `lpcli close <position>` — close a position and claim all fees.
 *
 * Usage:
 *   lpcli close <position_address>
 *
 * Requires wallet config. Shows confirmation prompt before sending.
 */

import { createInterface } from 'node:readline';
import { LPCLI, type ClosePositionResult } from '@lpcli/core';

// ---------------------------------------------------------------------------
// Readline confirm prompt
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
// Command entrypoint
// ---------------------------------------------------------------------------

export async function runClose(args: string[]): Promise<void> {
  const positionAddress = args[0];
  if (!positionAddress) {
    console.error('Usage: lpcli close <position_address>');
    process.exit(1);
  }

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
Close position: ${positionAddress}
  This will withdraw all liquidity and claim all fees.
`);

  const confirm = await ask(rl, 'Confirm? [y/N] ');
  rl.close();

  if (confirm.toLowerCase() !== 'y') {
    console.log('Aborted.');
    process.exit(0);
  }

  console.log('\nClosing position...');

  let result: ClosePositionResult;
  try {
    result = await dlmm.closePosition(positionAddress);
  } catch (err: unknown) {
    console.error('Failed to close position:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  console.log(`
Position closed successfully!

  Withdrawn X:     ${result.withdrawn_x}
  Withdrawn Y:     ${result.withdrawn_y}
  Claimed fees X:  ${result.claimed_fees_x}
  Claimed fees Y:  ${result.claimed_fees_y}
  TX:              ${result.tx}
`);
}
