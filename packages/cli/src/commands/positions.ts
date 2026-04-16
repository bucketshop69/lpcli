/**
 * `lpcli positions` — list all open positions for the configured wallet.
 *
 * Usage:
 *   lpcli positions                     List all positions (rich summary)
 *   lpcli positions --detail <address>  Full detail for one position
 */

import { LPCLI, type Position } from '@lpcli/core';
import { getFlag, formatStatus, shortAddr } from '../helpers.js';

// ---------------------------------------------------------------------------
// Rich list view
// ---------------------------------------------------------------------------

function tokenSymbols(p: Position): [string, string] {
  const parts = p.pool_name.split('-');
  return parts.length >= 2 ? [parts[0], parts.slice(1).join('-')] : [shortAddr(p.token_x_mint), shortAddr(p.token_y_mint)];
}

function renderList(positions: Position[]): void {
  console.log();
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const [symX, symY] = tokenSymbols(p);
    const status = formatStatus(p.status);
    const valX = p.current_value_x_ui.toFixed(4);
    const valY = p.current_value_y_ui.toFixed(4);
    const feeX = p.fees_earned_x_ui.toFixed(6);
    const feeY = p.fees_earned_y_ui.toFixed(6);

    console.log(`  [${i + 1}] ${p.pool_name}  |  ${status}`);
    console.log(`      Position:  ${p.address}`);
    console.log(`      Pool:      ${p.pool}`);
    console.log(`      Value:     ${valX} ${symX}  +  ${valY} ${symY}`);
    console.log(`      Fees:      ${feeX} ${symX}  +  ${feeY} ${symY}`);
    console.log(`      Range:     ${p.range_low.toFixed(6)} — ${p.range_high.toFixed(6)}  (${p.total_bins} bins, ${p.bin_step} bps)`);
    console.log(`      Price:     ${p.current_price.toFixed(6)}`);
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Detail view for a single position
// ---------------------------------------------------------------------------

function renderDetail(p: Position): void {
  const [symX, symY] = tokenSymbols(p);
  console.log(`
Position Detail
===============

  Pool:          ${p.pool_name}
  Status:        ${formatStatus(p.status)}

  Position addr: ${p.address}
  Pool addr:     ${p.pool}
  Token X:       ${symX}  (${p.token_x_mint})
  Token Y:       ${symY}  (${p.token_y_mint})

  Current Value
    ${symX}:     ${p.current_value_x_ui.toFixed(6)}
    ${symY}:     ${p.current_value_y_ui.toFixed(6)}

  Unclaimed Fees
    ${symX}:     ${p.fees_earned_x_ui.toFixed(6)}
    ${symY}:     ${p.fees_earned_y_ui.toFixed(6)}

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
