// ============================================================================
// Action Executor — @lpcli/monitor
//
// Executes actions when watcher conditions are met.
// Trade/close actions require OWS wallet.
// ============================================================================

import {
  LPCLI,
  PacificaClient,
  createMarketOrder,
  closePosition,
} from '@lpcli/core';
import type { Action, WatcherEvent } from './types.js';

export interface ExecutorContext {
  client: PacificaClient;
  lpcli: LPCLI;
}

/**
 * Execute a watcher action. Returns a description of what happened.
 * Throws on failure — caller handles error logging.
 */
export async function executeAction(
  action: Action,
  watcherId: string,
  watcherName: string,
  ctx: ExecutorContext,
): Promise<WatcherEvent> {
  const base = { watcherId, watcherName, timestamp: Date.now() };

  switch (action.type) {
    case 'alert': {
      const msg = action.message ?? `Watcher "${watcherName}" triggered`;
      return { ...base, type: 'action_executed', detail: `ALERT: ${msg}` };
    }

    case 'trade': {
      const wallet = await ctx.lpcli.getWallet();
      const side = action.side === 'long' ? 'bid' : 'ask' as const;
      const result = await createMarketOrder(wallet, {
        symbol: action.symbol,
        side,
        amount: action.amount,
        slippagePercent: 1,
      }, ctx.client);
      return {
        ...base,
        type: 'action_executed',
        detail: `TRADE: ${action.side.toUpperCase()} ${action.amount} ${action.symbol} — order #${result.orderId}`,
      };
    }

    case 'close_perp': {
      const wallet = await ctx.lpcli.getWallet();
      const result = await closePosition(wallet, action.symbol, ctx.client);
      if (!result) {
        return { ...base, type: 'action_failed', detail: `No open position for ${action.symbol}` };
      }
      return {
        ...base,
        type: 'action_executed',
        detail: `CLOSE PERP: ${action.symbol} — order #${result.orderId}`,
      };
    }

    case 'close_lp': {
      const dlmm = ctx.lpcli.dlmm;
      if (!dlmm) throw new Error('DLMM service not initialised — check wallet config');
      // closePosition takes the position address; for pool-based close we need
      // to find the position first
      const wallet = await ctx.lpcli.getWallet();
      const positions = await dlmm.getPositions(wallet.getPublicKey().toBase58());
      const pos = positions.find((p) => p.pool === action.pool);
      if (!pos) {
        return { ...base, type: 'action_failed', detail: `No Meteora position in pool ${action.pool.slice(0, 8)}...` };
      }
      const result = await dlmm.closePosition(pos.address);
      return {
        ...base,
        type: 'action_executed',
        detail: `CLOSE LP: pool ${action.pool.slice(0, 8)}... — ${result.token_x_symbol} + ${result.token_y_symbol}`,
      };
    }

    case 'webhook': {
      const body = {
        watcher: watcherName,
        watcherId,
        triggeredAt: new Date().toISOString(),
        ...action.body,
      };
      const resp = await fetch(action.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        throw new Error(`Webhook failed: ${resp.status} ${resp.statusText}`);
      }
      return { ...base, type: 'action_executed', detail: `WEBHOOK: POST ${action.url} — ${resp.status}` };
    }
  }
}
