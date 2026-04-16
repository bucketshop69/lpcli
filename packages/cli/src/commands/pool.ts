/**
 * `lpcli meteora pool <address>` — show detailed info for a specific pool.
 *
 * Usage:
 *   lpcli meteora pool <pool_address>
 *
 * No wallet needed — read-only.
 */

import { LPCLI, type PoolInfo } from '@lpcli/core';
import { formatMoney, formatPct } from '../helpers.js';

// ---------------------------------------------------------------------------
// Age formatter
// ---------------------------------------------------------------------------

function formatAge(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  if (days >= 30) return `${Math.floor(days / 30)}mo ${days % 30}d`;
  return `${days}d`;
}

// ---------------------------------------------------------------------------
// Command entrypoint
// ---------------------------------------------------------------------------

export async function runPool(args: string[]): Promise<void> {
  const address = args[0];
  if (!address) {
    console.error('Usage: lpcli meteora pool <address>');
    process.exit(1);
  }

  const lpcli = new LPCLI();

  // Try to init wallet/DLMM so active_bin can be resolved on-chain.
  try { await lpcli.getWallet(); } catch { /* read-only fallback */ }

  let info: PoolInfo;
  try {
    info = await lpcli.getPoolInfo(address);
  } catch (err: unknown) {
    console.error('Failed to fetch pool info:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  console.log(`
Pool: ${info.name}
Address: ${info.pool_address}
Type: ${info.pool_type.toUpperCase()}

  Tokens:        ${info.token_x} / ${info.token_y}
  Token X mint:  ${info.token_x_mint}
  Token Y mint:  ${info.token_y_mint}
  Bin Step:      ${info.bin_step > 0 ? `${info.bin_step} bps` : '—'}
  Pool Age:      ${formatAge(info.pool_age_ms)}
  Current Price: ${info.pool_price.toFixed(6)}
  Active Bin:    ${info.active_bin || '(wallet not connected)'}

  TVL:           ${formatMoney(info.tvl)}
  Active TVL:    ${formatMoney(info.active_tvl)}
  Fee %:         ${info.fee_pct}%

  Fees (24h):    ${formatMoney(info.fee_24h)}
  Avg Fees/Min:  ${formatMoney(info.avg_fee)}
  Fee/Ac.TVL:    ${formatPct(info.fee_active_tvl_ratio / 100)}

  Volume (24h):  ${formatMoney(info.volume_24h)}
  Avg Vol/Min:   ${formatMoney(info.avg_volume)}

  Volatility:    ${info.volatility.toFixed(2)}
  Swaps (24h):   ${Math.round(info.swap_count)}
  Traders (24h): ${Math.round(info.unique_traders)}

  Open Positions:     ${Math.round(info.open_positions)}
  In-Range Positions: ${Math.round(info.active_positions)} (${info.active_positions_pct.toFixed(1)}%)

  Has Farm:      ${info.has_farm ? 'Yes' : 'No'}
`);
}
