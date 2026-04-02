/**
 * `lpcli pool <address>` — show detailed info for a specific pool.
 *
 * Usage:
 *   lpcli pool <pool_address>
 *
 * No wallet needed — read-only.
 */

import { LPCLI, type PoolInfo } from '@lpcli/core';
import { loadConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// Command entrypoint
// ---------------------------------------------------------------------------

export async function runPool(args: string[]): Promise<void> {
  const address = args[0];
  if (!address) {
    console.error('Usage: lpcli pool <address>');
    process.exit(1);
  }

  const config = loadConfig();
  const lpcli = new LPCLI({
    rpcUrl: config.rpcUrl ?? 'https://api.mainnet-beta.solana.com',
    cluster: config.cluster ?? 'mainnet',
  });

  let info: PoolInfo;
  try {
    info = await lpcli.getPoolInfo(address);
  } catch (err: unknown) {
    console.error('Failed to fetch pool info:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  console.log(`
Pool: ${info.name}
Address: ${info.address}

  TVL:           ${formatMoney(info.tvl)}
  Volume 24h:    ${formatMoney(info.volume_24h)}
  Fees 24h:      ${formatMoney(info.fee_24h)}
  APR:           ${formatPct(info.apr / 100)}
  APY:           ${formatPct(info.apy / 100)}
  Current Price: ${info.current_price.toFixed(6)}
  Bin Step:      ${info.bin_step} bps
  Has Farm:      ${info.has_farm ? 'Yes' : 'No'}${info.has_farm ? `  (Farm APR: ${formatPct(info.farm_apr / 100)})` : ''}
`);
}
