// ============================================================================
// Pacifica REST Client — @lpcli/core
//
// HTTP layer for the Pacifica perps API.
// Public endpoints (no auth) + authenticated withdrawal.
// ============================================================================

import type { PacificaRequestEnvelope } from './pacifica.js';

// ============================================================================
// Constants
// ============================================================================

export const PACIFICA_REST_URL = 'https://api.pacifica.fi/api/v1';

// ============================================================================
// Types
// ============================================================================

export interface PacificaMarketInfo {
  symbol: string;
  tick_size: string;
  lot_size: string;
  max_leverage: number;
  min_order_size: string;
  max_order_size: string;
  funding_rate: string;
  isolated_only: boolean;
}

export interface PacificaPriceInfo {
  symbol: string;
  oracle: string;
  mark: string;
  mid: string;
  funding: string;
  open_interest: string;
  volume_24h: string;
  timestamp: number;
}

export interface PacificaAccountInfo {
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

export interface PacificaPosition {
  symbol: string;
  side: 'bid' | 'ask';
  amount: string;
  entry_price: string;
  funding: string;
  isolated: boolean;
  created_at: number;
  updated_at: number;
}

export interface PacificaOrder {
  order_id: number;
  symbol: string;
  side: 'bid' | 'ask';
  price: string;
  amount: string;
  filled_amount: string;
  order_type: string;
  tif: string;
  reduce_only: boolean;
  client_order_id: string;
  created_at: number;
}

// ============================================================================
// Errors
// ============================================================================

export class PacificaApiError extends Error {
  constructor(public code: number, public status: number, message: string) {
    super(message);
    this.name = 'PacificaApiError';
  }
}

// ============================================================================
// Client
// ============================================================================

export class PacificaClient {
  constructor(private baseUrl: string = PACIFICA_REST_URL) {}

  // --- Public endpoints (no auth) ---

  /** GET /info — list all available markets. */
  async getMarkets(): Promise<PacificaMarketInfo[]> {
    return this.get<PacificaMarketInfo[]>('/info');
  }

  /** GET /info/prices — current prices for all markets. */
  async getPrices(): Promise<PacificaPriceInfo[]> {
    return this.get<PacificaPriceInfo[]>('/info/prices');
  }

  /** GET /account?account=<address> — account balance and margin info. */
  async getAccountInfo(address: string): Promise<PacificaAccountInfo> {
    return this.get<PacificaAccountInfo>(`/account?account=${address}`);
  }

  /** GET /positions?account=<address> — open positions. */
  async getPositions(address: string): Promise<PacificaPosition[]> {
    return this.get<PacificaPosition[]>(`/positions?account=${address}`);
  }

  /** GET /orders?account=<address> — open orders. */
  async getOpenOrders(address: string): Promise<PacificaOrder[]> {
    return this.get<PacificaOrder[]>(`/orders?account=${address}`);
  }

  // --- Authenticated endpoints ---

  /**
   * Generic authenticated POST — sends a signed envelope to the given path.
   * Returns the parsed response body (the `data` field if present, else full body).
   */
  async postSigned<T = unknown>(path: string, envelope: PacificaRequestEnvelope): Promise<T> {
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
      throw new PacificaApiError(
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
  async requestWithdrawal(envelope: PacificaRequestEnvelope): Promise<void> {
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
      throw new PacificaApiError(
        body.code ?? resp.status,
        resp.status,
        body.error ?? `Request failed: ${resp.status}`,
      );
    }

    return body.data as T;
  }
}
