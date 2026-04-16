/**
 * Shared CLI helpers — arg parsing, readline prompts, formatters.
 *
 * Every command file was copy-pasting these. Now they live here.
 */

import { createInterface } from 'node:readline';
import type { Position } from '@lpcli/core';

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

/** Get the value following a --flag in an args array. */
export function getFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

/** Check whether a --flag is present in an args array. */
export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

// ---------------------------------------------------------------------------
// Readline prompts
// ---------------------------------------------------------------------------

export function createRL() {
  return createInterface({ input: process.stdin, output: process.stdout });
}

export function ask(rl: ReturnType<typeof createRL>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

/**
 * One-shot ask — creates and closes the readline interface automatically.
 * Use when you only need a single prompt.
 */
export function askOnce(question: string): Promise<string> {
  const rl = createRL();
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export function formatStatus(s: Position['status']): string {
  if (s === 'in_range') return 'IN RANGE';
  if (s === 'out_of_range_above') return 'OUT (above)';
  if (s === 'out_of_range_below') return 'OUT (below)';
  return 'CLOSED';
}

export function formatMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export function formatPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

/** Solscan transaction URL with terminal hyperlink escape. */
export function solscanTxUrl(signature: string): string {
  const url = `https://solscan.io/tx/${signature}`;
  return `\u001b]8;;${url}\u0007${url}\u001b]8;;\u0007`;
}

/** Truncate a base58 address for display: first4..last3 */
export function shortAddr(addr: string, head = 4, tail = 3): string {
  if (addr.length <= head + tail + 2) return addr;
  return `${addr.slice(0, head)}..${addr.slice(-tail)}`;
}
