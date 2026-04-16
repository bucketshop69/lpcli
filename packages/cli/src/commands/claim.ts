/**
 * `lpcli meteora claim <position>` — claim swap fees and convert to funding token.
 *
 * Usage:
 *   lpcli meteora claim <position_address>
 *     Claims fees, then swaps any non-funding tokens back to funding token.
 *     Pool is auto-detected from the position.
 *
 *   lpcli meteora claim <position_address> --pool <pool_address>
 *     Explicit pool (skips auto-detect lookup).
 *
 *   lpcli meteora claim <position_address> --no-swap
 *     Claim without swapping (fee tokens stay as-is in wallet).
 */

import { LPCLI } from '@lpcli/core';
import type { FundedClaimResult } from '@lpcli/core';
import { getFlag, hasFlag, createRL, ask, solscanTxUrl } from '../helpers.js';

// ---------------------------------------------------------------------------
// Command entrypoint
// ---------------------------------------------------------------------------

export async function runClaim(args: string[]): Promise<void> {
  const positionAddress = args[0];
  if (!positionAddress) {
    console.error('Usage: lpcli meteora claim <position_address> [--pool <pool_address>] [--no-swap]');
    process.exit(1);
  }

  const pool = getFlag(args, '--pool');
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
  Pool:           ${pool ?? '(auto-detect from position)'}
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
  TX:        ${solscanTxUrl(result.tx)}
`);
    return;
  }

  // ── Funded mode: claim + swap back ─────────────────────────────────────

  console.log('\nClaiming fees & swapping back...');

  let result: FundedClaimResult;
  try {
    result = await lpcli.claimToFunding(positionAddress, pool ?? undefined);
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
  Claim TX:   ${solscanTxUrl(result.claim.tx)}
  Swap-back:  ${result.swaps.length} swap(s) executed
`);

  for (const swap of result.swaps) {
    console.log(`    ${swap.inAmount} → ${swap.outAmount}`);
    console.log(`    ${solscanTxUrl(swap.signature)}`);
  }

  console.log();
}
