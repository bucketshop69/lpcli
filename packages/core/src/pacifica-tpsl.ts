// ============================================================================
// pacific TP/SL — @lpcli/core
//
// Set take-profit and stop-loss on existing positions via signed REST.
// All signing goes through signpacificRequest (OWS).
// ============================================================================

import { randomUUID } from 'node:crypto';
import type { WalletService } from './wallet.js';
import { signpacificRequest } from './pacific.js';
import { pacificClient } from './pacific-client.js';

// ============================================================================
// Types
// ============================================================================

export interface TPSLParams {
  symbol: string;
  /** Optional: set only if you want a take-profit. */
  takeProfit?: {
    /** Trigger price. */
    stopPrice: string;
    /** Limit price (omit for market order at trigger). */
    limitPrice?: string;
    /** Partial size (omit for full position). */
    amount?: string;
  };
  /** Optional: set only if you want a stop-loss. */
  stopLoss?: {
    /** Trigger price. */
    stopPrice: string;
    /** Limit price (omit for market order at trigger). */
    limitPrice?: string;
    /** Partial size (omit for full position). */
    amount?: string;
  };
}

// ============================================================================
// Set TP/SL
// ============================================================================

/**
 * Set take-profit and/or stop-loss on an existing position.
 * Auto-detects position side to determine the close side.
 */
export async function setPositionTPSL(
  wallet: WalletService,
  params: TPSLParams,
  client?: pacificClient,
): Promise<void> {
  const c = client ?? new pacificClient();
  const address = wallet.getPublicKey().toBase58();

  // Find the position to determine close side
  const positions = await c.getPositions(address);
  const pos = positions.find(
    (p) => p.symbol.toUpperCase() === params.symbol.toUpperCase(),
  );

  if (!pos) {
    throw new Error(`No open position for ${params.symbol}`);
  }

  // Close side is opposite of position side
  const closeSide = pos.side === 'bid' ? 'ask' : 'bid';

  const payload: Record<string, unknown> = {
    symbol: pos.symbol,
    side: closeSide,
  };

  if (params.takeProfit) {
    const tp: Record<string, string> = {
      stop_price: params.takeProfit.stopPrice,
      client_order_id: randomUUID(),
    };
    if (params.takeProfit.limitPrice) tp.limit_price = params.takeProfit.limitPrice;
    if (params.takeProfit.amount) tp.amount = params.takeProfit.amount;
    payload.take_profit = tp;
  }

  if (params.stopLoss) {
    const sl: Record<string, string> = {
      stop_price: params.stopLoss.stopPrice,
      client_order_id: randomUUID(),
    };
    if (params.stopLoss.limitPrice) sl.limit_price = params.stopLoss.limitPrice;
    if (params.stopLoss.amount) sl.amount = params.stopLoss.amount;
    payload.stop_loss = sl;
  }

  const header = {
    type: 'set_position_tpsl',
    timestamp: Date.now(),
    expiry_window: 5000,
  };

  const envelope = await signpacificRequest(wallet, header, payload);
  await c.postSigned('/positions/tpsl', envelope);
}
