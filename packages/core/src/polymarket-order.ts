// ============================================================================
// Polymarket Order Placement — @lpcli/core
//
// Places limit orders on Polymarket CLOB via the VPS relay.
// The relay signs orders with the derived key and submits with
// Builder attribution.
//
// Flow:
// 1. Resolve market (slug → condition ID → token IDs) via Dome/CLOB
// 2. POST /clob/order to relay with { polygonAddress, tokenID, price, amount, side }
// 3. Relay signs, submits, returns order result
// ============================================================================

import type { PolymarketRelayConfig } from './polymarket-auth.js';

// ============================================================================
// Types
// ============================================================================

export interface PolymarketOrderParams {
  /** Derived Polygon EOA address (from auth) */
  polygonAddress: string;
  /** Conditional token ID (YES or NO outcome token) */
  tokenID: string;
  /** Limit price (0 < price < 1) */
  price: number;
  /** Dollar amount to spend */
  amount: number;
  /** Order side */
  side: 'BUY' | 'SELL';
}

export interface PolymarketOrderResult {
  /** Order ID from CLOB */
  orderID?: string;
  /** Whether the order was successfully placed */
  success: boolean;
  /** Error message if failed */
  errorMsg?: string;
  /** Raw response from relay */
  raw: Record<string, unknown>;
}

export interface PolymarketCancelResult {
  /** Number of orders cancelled */
  canceled: number;
  /** Raw response */
  raw: Record<string, unknown>;
}

// ============================================================================
// Order Placement
// ============================================================================

/**
 * Place a limit order on Polymarket via VPS relay.
 *
 * @param params - Order parameters
 * @param config - Relay configuration
 */
export async function placeOrder(
  params: PolymarketOrderParams,
  config: PolymarketRelayConfig,
): Promise<PolymarketOrderResult> {
  if (params.price <= 0 || params.price >= 1) {
    throw new Error(`Invalid price: ${params.price} — must be between 0 and 1 (exclusive)`);
  }
  if (params.amount <= 0) {
    throw new Error(`Invalid amount: ${params.amount} — must be positive`);
  }

  const url = `${config.relayUrl.replace(/\/$/, '')}/clob/order`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      polygonAddress: params.polygonAddress,
      tokenID: params.tokenID,
      price: params.price,
      amount: params.amount,
      side: params.side,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      success: false,
      errorMsg: `Relay error (${res.status}): ${body}`,
      raw: {},
    };
  }

  const data = await res.json() as Record<string, unknown>;

  return {
    orderID: data.orderID as string | undefined,
    success: !!data.orderID || data.success === true,
    errorMsg: data.error as string | undefined,
    raw: data,
  };
}

// ============================================================================
// Open Orders
// ============================================================================

/**
 * Get open orders for a Polygon address via VPS relay.
 */
export async function getOpenOrders(
  polygonAddress: string,
  config: PolymarketRelayConfig,
): Promise<Record<string, unknown>[]> {
  const url = `${config.relayUrl.replace(/\/$/, '')}/clob/positions/${polygonAddress}`;
  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to fetch open orders (${res.status}): ${body}`);
  }

  const data = await res.json() as { orders?: Record<string, unknown>[] };
  return data.orders ?? [];
}

// ============================================================================
// Cancel
// ============================================================================

/**
 * Cancel an order by ID via VPS relay.
 */
export async function cancelOrder(
  polygonAddress: string,
  orderID: string,
  config: PolymarketRelayConfig,
): Promise<PolymarketCancelResult> {
  const url = `${config.relayUrl.replace(/\/$/, '')}/clob/cancel`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ polygonAddress, orderID }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cancel failed (${res.status}): ${body}`);
  }

  const data = await res.json() as Record<string, unknown>;
  return {
    canceled: (data.canceled as number) ?? 1,
    raw: data,
  };
}

/**
 * Cancel all open orders for a Polygon address via VPS relay.
 */
export async function cancelAllOrders(
  polygonAddress: string,
  config: PolymarketRelayConfig,
): Promise<PolymarketCancelResult> {
  const url = `${config.relayUrl.replace(/\/$/, '')}/clob/cancel-all`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ polygonAddress }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cancel all failed (${res.status}): ${body}`);
  }

  const data = await res.json() as Record<string, unknown>;
  return {
    canceled: (data.canceled as number) ?? 0,
    raw: data,
  };
}
