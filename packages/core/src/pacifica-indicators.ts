// ============================================================================
// Pacifica Indicators — @lpcli/core
//
// Technical indicators calculated from Pacifica kline data.
// Read-only, no signing required.
// ============================================================================

import { PacificaClient } from './pacifica-client.js';
import type { PacificaKlineInterval } from './pacifica-client.js';

// ============================================================================
// RSI — Wilder's 14-period smoothed RSI
// ============================================================================

/**
 * Calculate RSI from an array of close prices.
 * Uses Wilder's smoothing method (exponential moving average of gains/losses).
 *
 * @param closes - Array of close prices (oldest first).
 * @param period - RSI period (default 14).
 * @returns RSI value (0-100), or null if insufficient data.
 */
export function calculateRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;

  // Calculate price changes
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  // Initial average gain/loss over first `period` changes
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder's smoothing for remaining changes
  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ============================================================================
// Fetch RSI for a symbol
// ============================================================================

const INTERVAL_MS: Record<PacificaKlineInterval, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '4h': 14_400_000,
  '8h': 28_800_000,
  '12h': 43_200_000,
  '1d': 86_400_000,
};

export interface RSIResult {
  symbol: string;
  interval: PacificaKlineInterval;
  rsi: number;
  price: number;
  zone: 'overbought' | 'oversold' | 'neutral';
  candleCount: number;
}

/**
 * Fetch kline data and compute RSI for a symbol.
 */
export async function fetchRSI(
  symbol: string,
  interval: PacificaKlineInterval = '15m',
  period = 14,
  client?: PacificaClient,
): Promise<RSIResult> {
  const c = client ?? new PacificaClient();
  const now = Date.now();
  const intervalMs = INTERVAL_MS[interval];
  const startTime = now - 200 * intervalMs;

  const candles = await c.getKlines(symbol.toUpperCase(), interval, startTime);

  // Use only closed candles
  const closed = candles.filter((k) => k.T <= now);

  if (closed.length < period + 1) {
    throw new Error(`Insufficient data for ${symbol} ${interval}: got ${closed.length} candles, need ${period + 1}`);
  }

  const closes = closed.map((k) => parseFloat(k.c));
  const rsi = calculateRSI(closes, period);

  if (rsi === null) {
    throw new Error(`RSI calculation failed for ${symbol}`);
  }

  const price = closes[closes.length - 1];
  const zone = rsi >= 60 ? 'overbought' : rsi <= 40 ? 'oversold' : 'neutral';

  return {
    symbol: symbol.toUpperCase(),
    interval,
    rsi,
    price,
    zone,
    candleCount: closed.length,
  };
}
