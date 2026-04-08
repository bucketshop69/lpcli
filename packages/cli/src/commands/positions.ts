/**
 * `lpcli positions` — list all open positions for the configured wallet.
 *
 * Usage:
 *   lpcli positions                     List all positions (rich summary)
 *   lpcli positions --detail <address>  Full detail for one position
 */

import { LPCLI, type Position } from '@lpcli/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

function formatStatus(s: Position['status']): string {
  if (s === 'in_range') return 'IN RANGE';
  if (s === 'out_of_range_above') return 'OUT (above)';
  if (s === 'out_of_range_below') return 'OUT (below)';
  return 'CLOSED';
}

// ---------------------------------------------------------------------------
// Rich list view
// ---------------------------------------------------------------------------

function renderList(positions: Position[]): void {
  console.log();
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const status = formatStatus(p.status);
    const valX = p.current_value_x_ui.toFixed(4);
    const valY = p.current_value_y_ui.toFixed(4);
    const feeX = p.fees_earned_x_ui.toFixed(6);
    const feeY = p.fees_earned_y_ui.toFixed(6);

    console.log(`  [${i + 1}] ${p.pool_name}  |  ${status}`);
    console.log(`      Position:  ${p.address}`);
    console.log(`      Pool:      ${p.pool}`);
    console.log(`      Value:     ${valX} X  +  ${valY} Y`);
    console.log(`      Fees:      ${feeX} X  +  ${feeY} Y`);
    console.log(`      Range:     ${p.range_low.toFixed(6)} — ${p.range_high.toFixed(6)}  (${p.total_bins} bins, ${p.bin_step} bps)`);
    console.log(`      Price:     ${p.current_price.toFixed(6)}`);
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Detail view for a single position
// ---------------------------------------------------------------------------

function renderDetail(p: Position): void {
  console.log(`
Position Detail
===============

  Address:       ${p.address}
  Pool:          ${p.pool}
  Pool name:     ${p.pool_name}
  Status:        ${formatStatus(p.status)}

  Token X mint:  ${p.token_x_mint}
  Token Y mint:  ${p.token_y_mint}
  Token X dec:   ${p.token_x_decimals}
  Token Y dec:   ${p.token_y_decimals}

  Current Value
    X (raw):     ${p.current_value_x}
    X (UI):      ${p.current_value_x_ui.toFixed(6)}
    Y (raw):     ${p.current_value_y}
    Y (UI):      ${p.current_value_y_ui.toFixed(6)}

  Unclaimed Fees
    X (raw):     ${p.fees_earned_x}
    X (UI):      ${p.fees_earned_x_ui.toFixed(6)}
    Y (raw):     ${p.fees_earned_y}
    Y (UI):      ${p.fees_earned_y_ui.toFixed(6)}

  Price Range
    Low:         ${p.range_low.toFixed(6)}
    High:        ${p.range_high.toFixed(6)}
    Current:     ${p.current_price.toFixed(6)}
    Total bins:  ${p.total_bins}
    Bin step:    ${p.bin_step} bps
`);
}

// ---------------------------------------------------------------------------
// Command entrypoint
// ---------------------------------------------------------------------------

export async function runPositions(args: string[] = []): Promise<void> {
  const detailAddress = getFlag(args, '--detail');

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
  const walletAddress = wallet.getPublicKey().toBase58();
  console.log(`\nFetching positions for ${walletAddress}...`);

  const positions = await dlmm.getPositions(walletAddress);

  if (positions.length === 0) {
    console.log('\nNo open positions found.\n');
    return;
  }

  // Detail mode: show one position
  if (detailAddress) {
    const found = positions.find((p) => p.address === detailAddress);
    if (!found) {
      console.error(`Position ${detailAddress} not found in wallet.`);
      process.exit(1);
    }
    renderDetail(found);
    return;
  }

  // List mode: show all positions
  renderList(positions);
  console.log(`${positions.length} position(s) found.\n`);
}
