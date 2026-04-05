/**
 * `lpcli discover <token>` — find and rank DLMM pools for a token.
 *
 * Usage:
 *   lpcli discover SOL
 *   lpcli discover SOL --sort fee_yield --top 5
 *
 * No wallet needed — read-only.
 */

import { LPCLI, type ScoredPool } from '@lpcli/core';

// ---------------------------------------------------------------------------
// Arg parsing helpers
// ---------------------------------------------------------------------------

function getFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

// ---------------------------------------------------------------------------
// Table renderer — plain string, no external deps
// ---------------------------------------------------------------------------

function pad(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return str + ' '.repeat(width - str.length);
}

function formatTvl(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function formatPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function renderTable(pools: ScoredPool[]): void {
  // Column definitions: [header, width, value-getter]
  type Col = { header: string; width: number; get: (p: ScoredPool) => string };
  const cols: Col[] = [
    { header: 'Pool',     width: 20, get: (p) => p.name.slice(0, 20) },
    { header: 'Fee APR',  width: 9,  get: (p) => formatPct(p.fee_tvl_ratio_24h) },
    { header: 'TVL',      width: 9,  get: (p) => formatTvl(p.tvl) },
    { header: 'Vol 24h',  width: 9,  get: (p) => formatTvl(p.volume_24h) },
    { header: 'Score',    width: 7,  get: (p) => p.score.toFixed(1) },
  ];

  const sep = (left: string, mid: string, right: string, fill: string): string =>
    left + cols.map((c) => fill.repeat(c.width + 2)).join(mid) + right;

  const topLine    = sep('┌', '┬', '┐', '─');
  const midLine    = sep('├', '┼', '┤', '─');
  const bottomLine = sep('└', '┴', '┘', '─');

  const headerRow =
    '│' + cols.map((c) => ` ${pad(c.header, c.width)} `).join('│') + '│';

  console.log(topLine);
  console.log(headerRow);
  console.log(midLine);

  for (const pool of pools) {
    const row =
      '│' + cols.map((c) => ` ${pad(c.get(pool), c.width)} `).join('│') + '│';
    console.log(row);
  }

  console.log(bottomLine);
}

// ---------------------------------------------------------------------------
// Command entrypoint
// ---------------------------------------------------------------------------

export async function runDiscover(args: string[]): Promise<void> {
  const token = args[0];
  if (!token) {
    console.error('Usage: lpcli discover <token> [--sort score|fee_yield|volume|tvl] [--top N]');
    process.exit(1);
  }

  const sortRaw = getFlag(args, '--sort') ?? 'score';
  const validSorts = ['score', 'fee_yield', 'volume', 'tvl'] as const;
  type SortKey = typeof validSorts[number];

  if (!validSorts.includes(sortRaw as SortKey)) {
    console.error(`--sort must be one of: ${validSorts.join(', ')}`);
    process.exit(1);
  }
  const sortBy = sortRaw as SortKey;

  const topRaw = getFlag(args, '--top');
  const top = topRaw ? parseInt(topRaw, 10) : 10;

  const lpcli = new LPCLI();

  console.log(`\nSearching pools for ${token}...\n`);

  let pools: ScoredPool[];
  try {
    pools = await lpcli.discoverPools(token, sortBy, top);
  } catch (err: unknown) {
    console.error('Failed to fetch pools:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (pools.length === 0) {
    console.log(`No pools found for ${token}.`);
    return;
  }

  renderTable(pools);
  console.log(`\n${pools.length} pools found. Sorted by: ${sortBy}\n`);
}
