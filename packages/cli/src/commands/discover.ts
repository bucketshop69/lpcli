/**
 * `lpcli meteora discover [query]` — find and rank DLMM pools.
 *
 * Usage:
 *   lpcli meteora discover                  Top pools by fee efficiency
 *   lpcli meteora discover SOL              SOL pools
 *   lpcli meteora discover sol-usdc         Specific pair
 *   lpcli meteora discover <mint>           By token mint address
 *   lpcli meteora discover <pool_address>   By pool address
 *
 *   --sort <field>    Sort by: fee_active_tvl_ratio (default), avg_fee, avg_volume, active_tvl
 *   --top <N>         Max results (default 30)
 *   --page-size <N>   Results per page in interactive mode (default 10)
 *
 * Interactive mode: paginate with n/p, type [N] to open position, q to quit.
 * No wallet needed — read-only.
 */

import { LPCLI } from '@lpcli/core';
import type { DiscoveredPool } from '@lpcli/core';
import { getFlag, shortAddr, formatMoney } from '../helpers.js';

// ---------------------------------------------------------------------------
// Table renderer
// ---------------------------------------------------------------------------

function pad(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return str + ' '.repeat(width - str.length);
}

function padRight(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return ' '.repeat(width - str.length) + str;
}

function fmtFee(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtVol(n: number): string {
  if (n >= 10000) return `$${(n / 1000).toFixed(0)}K`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(0)}K%`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K%`;
  return `${n.toFixed(0)}%`;
}

type Col = { header: string; width: number; get: (p: DiscoveredPool) => string; align: 'left' | 'right' };

const COLUMNS: Col[] = [
  { header: '#',         width: 3,  get: () => '',  align: 'right' },
  { header: 'Pool',      width: 16, get: (p) => p.name, align: 'left' },
  { header: 'Address',   width: 9,  get: (p) => shortAddr(p.pool_address, 4, 3), align: 'left' },
  { header: 'Fees/Min',  width: 8,  get: (p) => fmtFee(p.avg_fee), align: 'right' },
  { header: 'APR',       width: 9,  get: (p) => fmtPct(p.fee_active_tvl_ratio * 365), align: 'right' },
  { header: 'AcTVL',     width: 9,  get: (p) => formatMoney(p.active_tvl), align: 'right' },
  { header: 'Volat.',    width: 6,  get: (p) => p.volatility.toFixed(2), align: 'right' },
  { header: 'Swaps',     width: 6,  get: (p) => p.swap_count >= 1000 ? `${(p.swap_count / 1000).toFixed(1)}K` : String(Math.round(p.swap_count)), align: 'right' },
  { header: 'Traders',   width: 7,  get: (p) => String(Math.round(p.unique_traders)), align: 'right' },
  { header: 'BinStp',    width: 6,  get: (p) => p.bin_step > 0 ? String(p.bin_step) : '—', align: 'right' },
];

function renderRow(cols: Col[], values: string[]): string {
  return '│' + cols.map((c, i) => {
    const v = values[i];
    const padded = c.align === 'right' ? padRight(v, c.width) : pad(v, c.width);
    return ` ${padded} `;
  }).join('│') + '│';
}

function renderLine(cols: Col[], left: string, mid: string, right: string): string {
  return left + cols.map((c) => '─'.repeat(c.width + 2)).join(mid) + right;
}

function renderPage(pools: DiscoveredPool[], pageStart: number, pageSize: number, total: number): void {
  const pageEnd = Math.min(pageStart + pageSize, total);
  const slice = pools.slice(pageStart, pageEnd);
  const page = Math.floor(pageStart / pageSize) + 1;
  const totalPages = Math.ceil(total / pageSize);

  console.log(renderLine(COLUMNS, '┌', '┬', '┐'));
  console.log(renderRow(COLUMNS, COLUMNS.map((c) => c.header)));
  console.log(renderLine(COLUMNS, '├', '┼', '┤'));

  for (let i = 0; i < slice.length; i++) {
    const pool = slice[i];
    const values = COLUMNS.map((c, ci) => {
      if (ci === 0) return String(pageStart + i + 1); // row number
      return c.get(pool);
    });
    console.log(renderRow(COLUMNS, values));
  }

  console.log(renderLine(COLUMNS, '└', '┴', '┘'));
  console.log(`\n  Page ${page}/${totalPages}  |  ${total} pools`);
}

// ---------------------------------------------------------------------------
// Interactive loop
// ---------------------------------------------------------------------------

async function runInteractive(pools: DiscoveredPool[], pageSize: number): Promise<void> {
  if (pools.length === 0) {
    console.log('\nNo pools match the filters.\n');
    return;
  }

  let pageStart = 0;
  const total = pools.length;

  // Enable raw mode for single-keypress input
  const stdin = process.stdin;
  const isInteractive = stdin.isTTY;

  if (!isInteractive) {
    // Non-interactive (piped) — just print all results
    renderPage(pools, 0, total, total);
    return;
  }

  const showPage = () => {
    // Clear screen for clean pagination
    process.stdout.write('\x1b[2J\x1b[H');
    renderPage(pools, pageStart, pageSize, total);

    const totalPages = Math.ceil(total / pageSize);
    const page = Math.floor(pageStart / pageSize) + 1;
    const hints: string[] = [];
    if (page < totalPages) hints.push('[n] next');
    if (page > 1) hints.push('[p] prev');
    hints.push('[1-' + Math.min(pageStart + pageSize, total) + '] open position');
    hints.push('[q] quit');
    console.log(`  ${hints.join('  ')}\n`);
  };

  showPage();

  // Read single keystrokes
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  let numBuffer = '';

  const cleanup = () => {
    stdin.setRawMode(false);
    stdin.pause();
    stdin.removeAllListeners('data');
  };

  return new Promise<void>((resolve) => {
    stdin.on('data', async (key: string) => {
      // Ctrl+C
      if (key === '\x03') {
        cleanup();
        process.exit(0);
      }

      // q = quit
      if (key === 'q' || key === 'Q') {
        cleanup();
        console.log('');
        resolve();
        return;
      }

      // n = next page
      if (key === 'n' || key === 'N') {
        numBuffer = '';
        const maxStart = Math.max(0, total - pageSize);
        if (pageStart < maxStart) {
          pageStart = Math.min(pageStart + pageSize, maxStart);
          showPage();
        }
        return;
      }

      // p = prev page
      if (key === 'p' || key === 'P') {
        numBuffer = '';
        if (pageStart > 0) {
          pageStart = Math.max(0, pageStart - pageSize);
          showPage();
        }
        return;
      }

      // Number input — accumulate digits, execute on Enter
      if (key >= '0' && key <= '9') {
        numBuffer += key;
        process.stdout.write(key);
        return;
      }

      // Enter — execute number selection
      if (key === '\r' || key === '\n') {
        if (numBuffer) {
          const idx = parseInt(numBuffer, 10) - 1;
          numBuffer = '';
          if (idx >= 0 && idx < total) {
            const selected = pools[idx];
            cleanup();
            console.log(`\nSelected: ${selected.name} (${selected.pool_address})`);
            console.log(`\nTo open a position, run:`);
            console.log(`  lpcli meteora open ${selected.pool_address} --amount <amount>\n`);
            resolve();
            return;
          } else {
            process.stdout.write(`\n  Invalid selection. Pick 1-${total}.\n`);
          }
        }
        return;
      }

      // Backspace
      if (key === '\x7f' || key === '\b') {
        if (numBuffer.length > 0) {
          numBuffer = numBuffer.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Command entrypoint
// ---------------------------------------------------------------------------

export async function runDiscover(args: string[]): Promise<void> {
  // Parse query — first non-flag arg that isn't a flag value
  const flagsWithValues = new Set(['--sort', '--top', '--page-size']);
  let query: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (flagsWithValues.has(args[i])) i++; // skip next (value)
      continue;
    }
    query = args[i];
    break;
  }

  const sortFlag = getFlag(args, '--sort');
  const topFlag = getFlag(args, '--top');
  const pageSizeFlag = getFlag(args, '--page-size');

  const validSorts = ['fee_active_tvl_ratio', 'avg_fee', 'avg_volume', 'active_tvl', 'swap_count'] as const;
  if (sortFlag && !validSorts.includes(sortFlag as typeof validSorts[number])) {
    console.error(`--sort must be one of: ${validSorts.join(', ')}`);
    process.exit(1);
  }

  const lpcli = new LPCLI();
  const discoverConfig = lpcli.getDiscoverConfig();

  const top = topFlag ? parseInt(topFlag, 10) : 30;
  const pageSize = pageSizeFlag ? parseInt(pageSizeFlag, 10) : discoverConfig.pageSize;

  console.log(`\nSearching pools${query ? ` for "${query}"` : ''}...\n`);

  let pools: DiscoveredPool[];
  try {
    pools = await lpcli.discoverPools(query, {
      ...discoverConfig,
      ...(sortFlag ? { defaultSort: sortFlag } : {}),
    });
  } catch (err: unknown) {
    console.error('Failed to fetch pools:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Cap at --top
  pools = pools.slice(0, top);

  await runInteractive(pools, pageSize);
}
