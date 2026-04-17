// ============================================================================
// pacific Trade — @lpcli/core
//
// Market orders, cancel orders via signed REST requests.
// All signing goes through signpacificRequest (OWS).
// ============================================================================

import { randomUUID } from 'node:crypto';
import type { WalletService } from './wallet.js';
import { signpacificRequest } from './pacific.js';
import { pacificClient } from './pacific-client.js';
import type { pacificMarketInfo } from './pacific-client.js';

// ============================================================================
// Types
// ============================================================================

export interface MarketOrderParams {
  symbol: string;
  /** 'bid' = long, 'ask' = short */
  side: 'bid' | 'ask';
  /** Size in asset units (e.g. 0.1 BTC). Will be rounded to lot_size. */
  amount: number;
  /** Slippage tolerance as a percentage (e.g. 0.5 = 0.5%). Default: 1 */
  slippagePercent?: number;
  /** If true, only reduces an existing position. */
  reduceOnly?: boolean;
  /** Optional client-generated order ID. Auto-generated if omitted. */
  clientOrderId?: string;
}

export interface LimitOrderParams {
  symbol: string;
  /** 'bid' = long, 'ask' = short */
  side: 'bid' | 'ask';
  /** Size in asset units. Will be rounded to lot_size. */
  amount: number;
  /** Limit price. */
  price: number;
  /** Time-in-force: GTC (default), IOC, FOK, POST_ONLY. */
  tif?: 'GTC' | 'IOC' | 'FOK' | 'POST_ONLY';
  /** If true, only reduces an existing position. */
  reduceOnly?: boolean;
  clientOrderId?: string;
}

export interface MarketOrderResult {
  orderId: number;
}

// ============================================================================
// Lot size validation
// ============================================================================

/**
 * Round an order size down to the nearest valid lot_size for the given market.
 * Returns 0 if the amount is smaller than lot_size.
 */
export function roundToLotSize(amount: number, market: pacificMarketInfo): number {
  const lotSize = parseFloat(market.lot_size);
  if (lotSize <= 0) return amount;
  return Math.floor(amount / lotSize) * lotSize;
}

/**
 * Validate that a symbol exists and the order amount meets lot_size.
 * Returns the market info for the symbol.
 */
export async function validateOrder(
  symbol: string,
  amount: number,
  client: pacificClient,
): Promise<pacificMarketInfo> {
  const markets = await client.getMarkets();
  const market = markets.find((m) => m.symbol.toUpperCase() === symbol.toUpperCase());
  if (!market) {
    const available = markets.map((m) => m.symbol).join(', ');
    throw new Error(`Unknown symbol: ${symbol}. Available: ${available}`);
  }

  const lotSize = parseFloat(market.lot_size);
  if (amount < lotSize) {
    throw new Error(
      `Amount ${amount} is below minimum lot size ${lotSize} for ${market.symbol}`,
    );
  }

  return market;
}

// ============================================================================
// Market order
// ============================================================================

/**
 * Place a market order on pacific.
 *
 * @returns The order ID from the exchange.
 */
export async function createMarketOrder(
  wallet: WalletService,
  params: MarketOrderParams,
  client?: pacificClient,
): Promise<MarketOrderResult> {
  const c = client ?? new pacificClient();

  // Validate symbol & lot size
  const market = await validateOrder(params.symbol, params.amount, c);
  const roundedAmount = roundToLotSize(params.amount, market);
  if (roundedAmount <= 0) {
    throw new Error(
      `Amount ${params.amount} rounds to 0 at lot size ${market.lot_size} for ${market.symbol}`,
    );
  }

  const payload: Record<string, unknown> = {
    symbol: market.symbol,
    side: params.side,
    amount: roundedAmount.toString(),
    slippage_percent: (params.slippagePercent ?? 1).toString(),
    reduce_only: params.reduceOnly ?? false,
    client_order_id: params.clientOrderId ?? randomUUID(),
  };

  const header = {
    type: 'create_market_order',
    timestamp: Date.now(),
    expiry_window: 5000,
  };

  const envelope = await signpacificRequest(wallet, header, payload);
  const result = await c.postSigned<{ order_id: number }>('/orders/create_market', envelope);

  return { orderId: result.order_id };
}

// ============================================================================
// Limit order
// ============================================================================

/**
 * Place a limit order on pacific (server-side, price-triggered).
 */
export async function createLimitOrder(
  wallet: WalletService,
  params: LimitOrderParams,
  client?: pacificClient,
): Promise<MarketOrderResult> {
  const c = client ?? new pacificClient();

  const market = await validateOrder(params.symbol, params.amount, c);
  const roundedAmount = roundToLotSize(params.amount, market);
  if (roundedAmount <= 0) {
    throw new Error(
      `Amount ${params.amount} rounds to 0 at lot size ${market.lot_size} for ${market.symbol}`,
    );
  }

  const payload: Record<string, unknown> = {
    symbol: market.symbol,
    side: params.side,
    amount: roundedAmount.toString(),
    price: params.price.toString(),
    tif: params.tif ?? 'GTC',
    reduce_only: params.reduceOnly ?? false,
    client_order_id: params.clientOrderId ?? randomUUID(),
  };

  const header = {
    type: 'create_order',
    timestamp: Date.now(),
    expiry_window: 5000,
  };

  const envelope = await signpacificRequest(wallet, header, payload);
  const result = await c.postSigned<{ order_id: number }>('/orders/create', envelope);

  return { orderId: result.order_id };
}

// ============================================================================
// Cancel order
// ============================================================================

/**
 * Cancel a single order by order ID.
 */
export async function cancelOrder(
  wallet: WalletService,
  orderId: number,
  symbol: string,
  client?: pacificClient,
): Promise<void> {
  const c = client ?? new pacificClient();

  const payload: Record<string, unknown> = {
    symbol,
    order_id: orderId,
  };

  const header = {
    type: 'cancel_order',
    timestamp: Date.now(),
    expiry_window: 5000,
  };

  const envelope = await signpacificRequest(wallet, header, payload);
  await c.postSigned('/orders/cancel', envelope);
}

/**
 * Cancel a stop order (SL/TP) by order ID.
 */
export async function cancelStopOrder(
  wallet: WalletService,
  orderId: number,
  symbol: string,
  client?: pacificClient,
): Promise<void> {
  const c = client ?? new pacificClient();

  const payload: Record<string, unknown> = {
    symbol,
    order_id: orderId,
  };

  const header = {
    type: 'cancel_stop_order',
    timestamp: Date.now(),
    expiry_window: 5000,
  };

  const envelope = await signpacificRequest(wallet, header, payload);
  await c.postSigned('/orders/stop/cancel', envelope);
}

// ============================================================================
// Cancel all orders
// ============================================================================

/**
 * Cancel all open orders across all symbols.
 */
export async function cancelAllOrders(
  wallet: WalletService,
  client?: pacificClient,
): Promise<void> {
  const c = client ?? new pacificClient();

  const payload: Record<string, unknown> = {
    all_symbols: true,
    exclude_reduce_only: false,
  };

  const header = {
    type: 'cancel_all_orders',
    timestamp: Date.now(),
    expiry_window: 5000,
  };

  const envelope = await signpacificRequest(wallet, header, payload);
  await c.postSigned('/orders/cancel_all', envelope);
}

// ============================================================================
// Close position (convenience)
// ============================================================================

/**
 * Close an existing position by placing a reduce-only market order
 * in the opposite direction for the full position size.
 *
 * @returns The order ID, or null if no position found for the symbol.
 */
export async function closePosition(
  wallet: WalletService,
  symbol: string,
  client?: pacificClient,
): Promise<MarketOrderResult | null> {
  const c = client ?? new pacificClient();
  const address = wallet.getPublicKey().toBase58();

  const positions = await c.getPositions(address);
  const pos = positions.find((p) => p.symbol.toUpperCase() === symbol.toUpperCase());

  if (!pos) return null;

  const size = parseFloat(pos.amount);
  if (size <= 0) return null;

  // Opposite side: if position is bid (long), close with ask (short) and vice versa
  const closeSide = pos.side === 'bid' ? 'ask' : 'bid';

  return createMarketOrder(wallet, {
    symbol: pos.symbol,
    side: closeSide,
    amount: size,
    reduceOnly: true,
    slippagePercent: 1,
  }, c);
}
