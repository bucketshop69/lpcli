// ============================================================================
// Pacifica Trade — @lpcli/core
//
// Market orders, cancel orders via signed REST requests.
// All signing goes through signPacificaRequest (OWS).
// ============================================================================

import { randomUUID } from 'node:crypto';
import type { WalletService } from './wallet.js';
import { signPacificaRequest } from './pacifica.js';
import { PacificaClient } from './pacifica-client.js';
import type { PacificaMarketInfo } from './pacifica-client.js';

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
export function roundToLotSize(amount: number, market: PacificaMarketInfo): number {
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
  client: PacificaClient,
): Promise<PacificaMarketInfo> {
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
 * Place a market order on Pacifica.
 *
 * @returns The order ID from the exchange.
 */
export async function createMarketOrder(
  wallet: WalletService,
  params: MarketOrderParams,
  client?: PacificaClient,
): Promise<MarketOrderResult> {
  const c = client ?? new PacificaClient();

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

  const envelope = await signPacificaRequest(wallet, header, payload);
  const result = await c.postSigned<{ order_id: number }>('/orders/create_market', envelope);

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
  client?: PacificaClient,
): Promise<void> {
  const c = client ?? new PacificaClient();

  const payload: Record<string, unknown> = {
    symbol,
    order_id: orderId,
  };

  const header = {
    type: 'cancel_order',
    timestamp: Date.now(),
    expiry_window: 5000,
  };

  const envelope = await signPacificaRequest(wallet, header, payload);
  await c.postSigned('/orders/cancel', envelope);
}

// ============================================================================
// Cancel all orders
// ============================================================================

/**
 * Cancel all open orders across all symbols.
 */
export async function cancelAllOrders(
  wallet: WalletService,
  client?: PacificaClient,
): Promise<void> {
  const c = client ?? new PacificaClient();

  const payload: Record<string, unknown> = {
    all_symbols: true,
    exclude_reduce_only: false,
  };

  const header = {
    type: 'cancel_all_orders',
    timestamp: Date.now(),
    expiry_window: 5000,
  };

  const envelope = await signPacificaRequest(wallet, header, payload);
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
  client?: PacificaClient,
): Promise<MarketOrderResult | null> {
  const c = client ?? new PacificaClient();
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
