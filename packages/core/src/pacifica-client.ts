// ============================================================================
// pacific REST Client — @lpcli/core
//
// HTTP layer for the pacific perps API.
// Public endpoints (no auth) + authenticated withdrawal.
// ============================================================================

import type { pacificRequestEnvelope } from './pacific.js';

// ============================================================================
// Constants
// ============================================================================

export const pacific_REST_URL = 'https://api.pacific.fi/api/v1';

// ============================================================================
// Types
// ============================================================================

export interface pacificMarketInfo {
  symbol: string;
  tick_size: string;
  lot_size: string;
  max_leverage: number;
  min_order_size: string;
  max_order_size: string;
  funding_rate: string;
  isolated_only: boolean;
}

export interface pacificPriceInfo {
  symbol: string;
  oracle: string;
  mark: string;
  mid: string;
  funding: string;
  open_interest: string;
  volume_24h: string;
  timestamp: number;
}

export interface pacificAccountInfo {
  balance: string;
  account_equity: string;
  available_to_spend: string;
  available_to_withdraw: string;
  total_margin_used: string;
  cross_mmr: string;
  fee_level: number;
  maker_fee: string;
  taker_fee: string;
  positions_count: number;
  orders_count: number;
  stop_orders_count: number;
  updated_at: number;
}

export interface pacificPosition {
  symbol: string;
  side: 'bid' | 'ask';
  amount: string;
  entry_price: string;
  funding: string;
  isolated: boolean;
  created_at: number;
  updated_at: number;
}

export interface pacificOrder {
  order_id: number;
  symbol: string;
  side: 'bid' | 'ask';
  price: string;
  initial_amount: string;
  amount?: string;
  filled_amount: string;
  cancelled_amount?: string;
  stop_price?: string;
  order_type: string;
  stop_parent_order_id?: number | null;
  trigger_price_type?: string;
  tif?: string;
  reduce_only: boolean;
  instrument_type?: string;
  client_order_id?: string | null;
  created_at: number;
  updated_at?: number;
}

export interface pacificKline {
  t: number;   // open time ms
  T: number;   // close time ms
  s: string;   // symbol
  i: string;   // interval
  o: string;   // open
  h: string;   // high
  l: string;   // low
  c: string;   // close
  v: string;   // volume
  n: number;   // trade count
}

export const pacific_KLINE_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d'] as const;
export type pacificKlineInterval = typeof pacific_KLINE_INTERVALS[number];

// ============================================================================
// Errors
// ============================================================================

export class pacificApiError extends Error {
  constructor(public code: number, public status: number, message: string) {
    super(message);
    this.name = 'pacificApiError';
  }
}

// ============================================================================
// Client
// ============================================================================

export class pacificClient {
  constructor(private baseUrl: string = pacific_REST_URL) { }

  // --- Public endpoints (no auth) ---

  /** GET /info — list all available markets. */
  async getMarkets(): Promise<pacificMarketInfo[]> {
    return this.get<pacificMarketInfo[]>('/info');
  }

  /** GET /info/prices — current prices for all markets. */
  async getPrices(): Promise<pacificPriceInfo[]> {
    return this.get<pacificPriceInfo[]>('/info/prices');
  }

  /** GET /account?account=<address> — account balance and margin info. */
  async getAccountInfo(address: string): Promise<pacificAccountInfo> {
    return this.get<pacificAccountInfo>(`/account?account=${address}`);
  }

  /** GET /positions?account=<address> — open positions. */
  async getPositions(address: string): Promise<pacificPosition[]> {
    return this.get<pacificPosition[]>(`/positions?account=${address}`);
  }

  /** GET /kline — candlestick data. */
  async getKlines(symbol: string, interval: pacificKlineInterval, startTime: number): Promise<pacificKline[]> {
    return this.get<pacificKline[]>(`/kline?symbol=${symbol}&interval=${interval}&start_time=${startTime}`);
  }

  /** GET /orders?account=<address> — open orders. */
  async getOpenOrders(address: string): Promise<pacificOrder[]> {
    return this.get<pacificOrder[]>(`/orders?account=${address}`);
  }

  // --- Authenticated endpoints ---

  /**
   * Generic authenticated POST — sends a signed envelope to the given path.
   * Returns the parsed response body (the `data` field if present, else full body).
   */
  async postSigned<T = unknown>(path: string, envelope: pacificRequestEnvelope): Promise<T> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });

    const body = await resp.json().catch(() => ({ error: resp.statusText })) as {
      success?: boolean;
      data?: T;
      code?: number;
      error?: string;
      order_id?: number;
    };

    if (!resp.ok || body.success === false) {
      throw new pacificApiError(
        body.code ?? resp.status,
        resp.status,
        body.error ?? `Request failed: ${resp.status}`,
      );
    }

    return (body.data ?? body) as T;
  }

  /**
   * POST /account/withdraw — submit a signed withdrawal request.
   */
  async requestWithdrawal(envelope: pacificRequestEnvelope): Promise<void> {
    await this.postSigned('/account/withdraw', envelope);
  }

  // --- Internal ---

  private async get<T>(path: string): Promise<T> {
    const resp = await fetch(`${this.baseUrl}${path}`);

    const body = await resp.json() as {
      success?: boolean;
      data?: T;
      code?: number;
      error?: string;
    };

    if (!resp.ok || !body.success) {
      throw new pacificApiError(
        body.code ?? resp.status,
        resp.status,
        body.error ?? `Request failed: ${resp.status}`,
      );
    }

    return body.data as T;
  }
}
