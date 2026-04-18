// ============================================================================
// Condition Evaluators — @lpcli/monitor
//
// Each evaluator fetches data and returns true/false for a condition.
// Evaluators are stateless — the engine manages caching per tick.
// ============================================================================

import {
  PacificaClient,
  fetchRSI,
  LPCLI,
} from '@lpcli/core';
import type {
  Condition,
  RsiCondition,
  PriceCondition,
  FundingRateCondition,
  PositionStatusCondition,
  HasPositionCondition,
} from './types.js';

// ============================================================================
// Per-tick data cache — shared across evaluators within a single tick
// ============================================================================

export interface TickCache {
  prices?: Map<string, { mark: number; funding: number }>;
  rsi?: Map<string, number>; // key = "symbol:timeframe"
  meteoraPositions?: Map<string, string>; // pool → status
  pacificaPositions?: Set<string>; // symbols with open positions
}

// ============================================================================
// Data fetchers — populate cache lazily
// ============================================================================

async function ensurePrices(cache: TickCache, client: PacificaClient): Promise<void> {
  if (cache.prices) return;
  const prices = await client.getPrices();
  cache.prices = new Map(
    prices.map((p) => [p.symbol.toUpperCase(), { mark: parseFloat(p.mark), funding: parseFloat(p.funding) }]),
  );
}

async function ensureRsi(cache: TickCache, symbol: string, timeframe: string): Promise<void> {
  const key = `${symbol}:${timeframe}`;
  if (cache.rsi?.has(key)) return;
  if (!cache.rsi) cache.rsi = new Map();
  const result = await fetchRSI(symbol, timeframe as '15m');
  cache.rsi.set(key, result.rsi);
}

async function ensureMeteoraPositions(cache: TickCache, lpcli: LPCLI): Promise<void> {
  if (cache.meteoraPositions) return;
  cache.meteoraPositions = new Map();
  try {
    const dlmm = lpcli.dlmm;
    if (!dlmm) return;
    const wallet = await lpcli.getWallet();
    const positions = await dlmm.getPositions(wallet.getPublicKey().toBase58());
    for (const pos of positions) {
      cache.meteoraPositions.set(pos.pool, pos.status);
    }
  } catch {
    // Wallet not available or no positions — leave empty
  }
}

async function ensurePacificaPositions(cache: TickCache, client: PacificaClient, lpcli: LPCLI): Promise<void> {
  if (cache.pacificaPositions) return;
  cache.pacificaPositions = new Set();
  try {
    const wallet = await lpcli.getWallet();
    const address = wallet.getPublicKey().toBase58();
    const positions = await client.getPositions(address);
    for (const pos of positions) {
      cache.pacificaPositions.add(pos.symbol.toUpperCase());
    }
  } catch {
    // Wallet not available — leave empty
  }
}

// ============================================================================
// Evaluate a single condition
// ============================================================================

function compare(actual: number, op: '>' | '<', target: number): boolean {
  return op === '>' ? actual > target : actual < target;
}

async function evalRsi(cond: RsiCondition, cache: TickCache): Promise<boolean> {
  await ensureRsi(cache, cond.symbol, cond.timeframe);
  const rsi = cache.rsi!.get(`${cond.symbol}:${cond.timeframe}`);
  if (rsi === undefined) return false;
  return compare(rsi, cond.op, cond.value);
}

async function evalPrice(cond: PriceCondition, cache: TickCache, client: PacificaClient): Promise<boolean> {
  await ensurePrices(cache, client);
  const price = cache.prices!.get(cond.symbol.toUpperCase());
  if (!price) return false;
  return compare(price.mark, cond.op, cond.value);
}

async function evalFundingRate(cond: FundingRateCondition, cache: TickCache, client: PacificaClient): Promise<boolean> {
  await ensurePrices(cache, client);
  const price = cache.prices!.get(cond.symbol.toUpperCase());
  if (!price) return false;
  return compare(Math.abs(price.funding), cond.op, cond.value);
}

async function evalPositionStatus(cond: PositionStatusCondition, cache: TickCache, lpcli: LPCLI): Promise<boolean> {
  await ensureMeteoraPositions(cache, lpcli);
  const status = cache.meteoraPositions!.get(cond.pool);
  if (!status) return false;
  if (cond.status === 'out_of_range') {
    return status === 'out_of_range_above' || status === 'out_of_range_below';
  }
  return status === cond.status;
}

async function evalHasPosition(cond: HasPositionCondition, cache: TickCache, client: PacificaClient, lpcli: LPCLI): Promise<boolean> {
  if (cond.protocol === 'pacifica') {
    await ensurePacificaPositions(cache, client, lpcli);
    return cache.pacificaPositions!.has(cond.identifier.toUpperCase());
  }
  // Meteora — identifier is pool address
  await ensureMeteoraPositions(cache, lpcli);
  return cache.meteoraPositions!.has(cond.identifier);
}

// ============================================================================
// Public API
// ============================================================================

export interface EvalContext {
  client: PacificaClient;
  lpcli: LPCLI;
  cache: TickCache;
}

/**
 * Evaluate a single condition against the current tick cache.
 * Fetches data lazily — subsequent conditions sharing the same data source
 * will use the cached result.
 */
export async function evaluateCondition(cond: Condition, ctx: EvalContext): Promise<boolean> {
  switch (cond.type) {
    case 'rsi':
      return evalRsi(cond, ctx.cache);
    case 'price':
      return evalPrice(cond, ctx.cache, ctx.client);
    case 'funding_rate':
      return evalFundingRate(cond, ctx.cache, ctx.client);
    case 'position_status':
      return evalPositionStatus(cond, ctx.cache, ctx.lpcli);
    case 'has_position':
      return evalHasPosition(cond, ctx.cache, ctx.client, ctx.lpcli);
  }
}

/**
 * Evaluate ALL conditions for a watcher (implicit AND).
 * Short-circuits on first false.
 */
export async function evaluateAll(conditions: Condition[], ctx: EvalContext): Promise<boolean> {
  for (const cond of conditions) {
    if (!(await evaluateCondition(cond, ctx))) return false;
  }
  return true;
}
