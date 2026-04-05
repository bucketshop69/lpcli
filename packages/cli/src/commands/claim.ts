/**
 * `lpcli claim <position>` — claim swap fees and convert to funding token.
 *
 * Usage:
 *   lpcli claim <position_address> --pool <pool_address>
 *     Claims fees, then swaps any non-funding tokens back to funding token.
 *     SOL fee reserve (0.02 SOL) is preserved.
 *
 *   lpcli claim <position_address> --pool <pool_address> --no-swap
 *     Claim without swapping (fee tokens stay as-is in wallet).
 */

import { createInterface } from 'node:readline';
import { LPCLI } from '@lpcli/core';
import type { FundedClaimResult } from '@lpcli/core';

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

export async function runClaim(args: string[]): Promise<void> {
  const positionAddress = args[0];
  if (!positionAddress) {
    console.error('Usage: lpcli claim <position_address> --pool <pool_address> [--no-swap]');
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
Claim fees from position: ${positionAddress}
  Pool:           ${pool}
  Swap back to:   ${noSwap ? '(none — tokens stay in wallet)' : `${funding.symbol} (${funding.mint.slice(0, 8)}...)`}
  SOL fee reserve: ${lpcli.config.feeReserveSol} SOL
`);
  const confirm = await ask(rl, 'Confirm? [y/N] ');
  rl.close();

  if (confirm.toLowerCase() !== 'y') {
    console.log('Aborted.');
    process.exit(0);
  }

  // ── No-swap mode: just claim ───────────────────────────────────────────

  if (noSwap) {
    console.log('\nClaiming fees...');

    let result: { claimedX: number; claimedY: number; tx: string };
    try {
      result = await lpcli.dlmm!.claimFees(positionAddress);
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

  Claimed X: ${result.claimedX}
  Claimed Y: ${result.claimedY}
  TX:        ${result.tx}
`);
    return;
  }

  // ── Funded mode: claim + swap back ─────────────────────────────────────

  console.log('\nClaiming fees & swapping back...');

  let result: FundedClaimResult;
  try {
    result = await lpcli.claimToFunding(positionAddress, pool);
  } catch (err: unknown) {
    console.error('Failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (!result.claim.tx) {
    console.log('\nNo fees available to claim.\n');
    return;
  }

  console.log(`
Fees claimed successfully!

  Claimed X:  ${result.claim.claimedX}
  Claimed Y:  ${result.claim.claimedY}
  Claim TX:   ${result.claim.tx}
  Swap-back:  ${result.swaps.length} swap(s) executed
`);

  for (const swap of result.swaps) {
    console.log(`    ${swap.inAmount} → ${swap.outAmount} (sig: ${swap.signature})`);
  }

  console.log();
}
