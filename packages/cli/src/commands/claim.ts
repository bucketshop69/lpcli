/**
 * `lpcli claim <position>` — claim swap fees without closing the position.
 *
 * Usage:
 *   lpcli claim <position_address>
 *
 * Requires wallet config.
 */

import { createInterface } from 'node:readline';
import { LPCLI } from '@lpcli/core';

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

export async function runClaim(args: string[]): Promise<void> {
  const positionAddress = args[0];
  if (!positionAddress) {
    console.error('Usage: lpcli claim <position_address>');
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
  console.log(`\nClaim fees from position: ${positionAddress}\n`);
  const confirm = await ask(rl, 'Confirm? [y/N] ');
  rl.close();

  if (confirm.toLowerCase() !== 'y') {
    console.log('Aborted.');
    process.exit(0);
  }

  console.log('\nClaiming fees...');

  let result: { claimedX: number; claimedY: number; tx: string };
  try {
    result = await dlmm.claimFees(positionAddress);
  } catch (err: unknown) {
    console.error('Failed to claim fees:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (!result.tx) {
    console.log('\nNo fees available to claim.\n');
    return;
  }

  console.log(`
Fees claimed successfully!

  Claimed X:  ${result.claimedX}
  Claimed Y:  ${result.claimedY}
  TX:         ${result.tx}
`);
}
