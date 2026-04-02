/**
 * `lpcli positions` — list all open positions for the configured wallet.
 *
 * Usage:
 *   lpcli positions
 *
 * Requires wallet config.
 */

import { LPCLI, WalletService, DLMMService, type Position } from '@lpcli/core';
import { loadConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Table renderer — plain string, no external deps
// ---------------------------------------------------------------------------

function pad(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return str + ' '.repeat(width - str.length);
}

function formatStatus(s: Position['status']): string {
  if (s === 'in_range') return 'IN RANGE';
  if (s === 'out_of_range') return 'OUT';
  return 'CLOSED';
}

function formatPnl(n: number | null): string {
  if (n === null) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}$${n.toFixed(2)}`;
}

function formatFees(x: number, y: number): string {
  return `${x.toFixed(4)} / ${y.toFixed(4)}`;
}

function renderTable(positions: Position[]): void {
  type Col = { header: string; width: number; get: (p: Position) => string };
  const cols: Col[] = [
    { header: 'Pool',        width: 16, get: (p) => p.pool_name.slice(0, 16) },
    { header: 'Status',      width: 10, get: (p) => formatStatus(p.status) },
    { header: 'P&L',         width: 10, get: (p) => formatPnl(p.pnl_usd) },
    { header: 'Fees (X/Y)',  width: 24, get: (p) => formatFees(p.fees_earned_x, p.fees_earned_y) },
    { header: 'Range Low',   width: 12, get: (p) => p.range_low.toFixed(4) },
    { header: 'Range High',  width: 12, get: (p) => p.range_high.toFixed(4) },
  ];

  const sep = (left: string, mid: string, right: string, fill: string): string =>
    left + cols.map((c) => fill.repeat(c.width + 2)).join(mid) + right;

  const topLine    = sep('┌', '┬', '┐', '─');
  const midLine    = sep('├', '┼', '┤', '─');
  const bottomLine = sep('└', '┴', '┘', '─');
  const headerRow  = '│' + cols.map((c) => ` ${pad(c.header, c.width)} `).join('│') + '│';

  console.log(topLine);
  console.log(headerRow);
  console.log(midLine);

  for (const pos of positions) {
    const row = '│' + cols.map((c) => ` ${pad(c.get(pos), c.width)} `).join('│') + '│';
    console.log(row);
  }

  console.log(bottomLine);
}

// ---------------------------------------------------------------------------
// Command entrypoint
// ---------------------------------------------------------------------------

export async function runPositions(): Promise<void> {
  const config = loadConfig();

  if (!config.rpcUrl) {
    console.error('Run `lpcli init` first.');
    process.exit(1);
  }

  let wallet: WalletService;
  try {
    wallet = await WalletService.init({
      rpcUrl: config.rpcUrl,
      privateKey: config.privateKey,
      owsWalletName: config.owsWalletName,
    });
  } catch (err: unknown) {
    console.error('Wallet error:', err instanceof Error ? err.message : String(err));
    console.error('Run `lpcli init` to set up your wallet.');
    process.exit(1);
  }

  const dlmm = new DLMMService({
    rpcUrl: config.rpcUrl,
    wallet,
    cluster: config.cluster ?? 'mainnet',
  });

  const walletAddress = wallet.getPublicKey().toBase58();
  console.log(`\nFetching positions for ${walletAddress}...\n`);

  const positions = await dlmm.getPositions(walletAddress);

  if (positions.length === 0) {
    console.log('No open positions found.\n');
    return;
  }

  renderTable(positions);
  console.log(`\n${positions.length} position(s) found.\n`);
}
