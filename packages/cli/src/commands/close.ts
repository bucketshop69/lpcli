/**
 * `lpcli close` — interactive position close with swap-back.
 *
 * Usage:
 *   lpcli close
 *     Fetches all open positions, shows them, lets you pick one to close.
 *     Automatically swaps proceeds back to funding token.
 *
 *   lpcli close --no-swap
 *     Same flow but skips the swap-back (tokens stay as-is in wallet).
 *
 *   lpcli close <position_address> --pool <pool_address>
 *     Direct close (legacy / scripting mode).
 */

import { LPCLI } from '@lpcli/core';
import type { Position, FundedCloseResult, ClosePositionResult } from '@lpcli/core';
import { getFlag, hasFlag, createRL, ask, formatStatus, solscanTxUrl, shortAddr } from '../helpers.js';

// ---------------------------------------------------------------------------
// Display positions table
// ---------------------------------------------------------------------------

function showPositions(positions: Position[]): void {
  console.log();
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    console.log(`  [${i + 1}] ${p.pool_name}  |  ${formatStatus(p.status)}`);
    console.log(`      Position: ${p.address}`);
    console.log(`      Pool:     ${p.pool}`);
    console.log(`      Value:    ${p.current_value_x_ui.toFixed(4)} X  +  ${p.current_value_y_ui.toFixed(4)} Y`);
    console.log(`      Fees:     ${p.fees_earned_x_ui.toFixed(6)} X  +  ${p.fees_earned_y_ui.toFixed(6)} Y`);
    console.log(`      Range:    ${p.range_low.toFixed(6)} — ${p.range_high.toFixed(6)}  (${p.total_bins} bins)`);
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Print close results
// ---------------------------------------------------------------------------

function printCloseResult(result: ClosePositionResult): void {
  console.log(`
Position closed!

  Withdrawn X:    ${result.withdrawn_x}
  Withdrawn Y:    ${result.withdrawn_y}
  Claimed fees X: ${result.claimed_fees_x}
  Claimed fees Y: ${result.claimed_fees_y}
  TX:             ${solscanTxUrl(result.tx)}
`);
}

function printFundedCloseResult(result: FundedCloseResult): void {
  console.log(`
Position closed!

  Withdrawn X:    ${result.close.withdrawn_x}
  Withdrawn Y:    ${result.close.withdrawn_y}
  Claimed fees X: ${result.close.claimed_fees_x}
  Claimed fees Y: ${result.close.claimed_fees_y}
  Close TX:       ${solscanTxUrl(result.close.tx)}
  Swap-back:      ${result.swaps.length} swap(s) executed
`);

  for (const swap of result.swaps) {
    console.log(`    ${swap.inAmount} → ${swap.outAmount}`);
    console.log(`    ${solscanTxUrl(swap.signature)}`);
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Command entrypoint
// ---------------------------------------------------------------------------

export async function runClose(args: string[]): Promise<void> {
  const noSwap = hasFlag(args, '--no-swap');

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
  const funding = lpcli.getFundingToken();

  // ── Direct mode: position address passed as arg ────────────────────────
  const firstArg = args[0];
  const looksLikeAddress = firstArg && !firstArg.startsWith('--') && firstArg.length > 30;

  if (looksLikeAddress) {
    const positionAddress = firstArg;
    const pool = getFlag(args, '--pool') ?? await dlmm.resolvePoolForPosition(positionAddress);
    await executeClose(lpcli, positionAddress, pool, noSwap, funding.symbol);
    return;
  }

  // ── Interactive mode: fetch positions and let user pick ────────────────
  const walletAddress = wallet.getPublicKey().toBase58();
  console.log(`\nFetching positions for ${walletAddress}...`);

  const positions = await dlmm.getPositions(walletAddress);

  if (positions.length === 0) {
    console.log('\nNo open positions found.\n');
    return;
  }

  showPositions(positions);

  let selected: Position;

  if (positions.length === 1) {
    selected = positions[0];
    const rl = createRL();
    console.log(`Only one position found: ${selected.pool_name} (${selected.address.slice(0, 12)}...)`);
    const confirm = await ask(rl, `Close this position${noSwap ? '' : ` and swap back to ${funding.symbol}`}? [y/N] `);
    rl.close();
    if (confirm.toLowerCase() !== 'y') {
      console.log('Aborted.');
      return;
    }
  } else {
    const rl = createRL();
    const choice = await ask(rl, `Select position to close [1-${positions.length}]: `);
    rl.close();

    const idx = parseInt(choice, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= positions.length) {
      console.error('Invalid selection.');
      process.exit(1);
    }

    selected = positions[idx];

    const rl2 = createRL();
    console.log(`\nClosing: ${selected.pool_name} (${selected.address.slice(0, 12)}...)`);
    const confirm = await ask(rl2, `Confirm close${noSwap ? '' : ` + swap back to ${funding.symbol}`}? [y/N] `);
    rl2.close();

    if (confirm.toLowerCase() !== 'y') {
      console.log('Aborted.');
      return;
    }
  }

  await executeClose(lpcli, selected.address, selected.pool, noSwap, funding.symbol);
}

// ---------------------------------------------------------------------------
// Execute close (shared between direct and interactive modes)
// ---------------------------------------------------------------------------

async function executeClose(
  lpcli: LPCLI,
  positionAddress: string,
  pool: string,
  noSwap: boolean,
  fundingSymbol: string,
): Promise<void> {
  if (noSwap) {
    console.log('\nClosing position...');
    let result: ClosePositionResult;
    try {
      result = await lpcli.dlmm!.closePosition(positionAddress);
    } catch (err: unknown) {
      console.error('Failed to close position:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    printCloseResult(result);
  } else {
    console.log(`\nClosing position & swapping back to ${fundingSymbol}...`);
    let result: FundedCloseResult;
    try {
      result = await lpcli.closeToFunding(positionAddress, pool);
    } catch (err: unknown) {
      console.error('Failed:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    printFundedCloseResult(result);
  }
}
