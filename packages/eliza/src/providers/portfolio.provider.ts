/**
 * Portfolio Provider — injects current portfolio state into every message context.
 *
 * The LLM always knows the user's positions, orders, and balances.
 * This enables intelligent suggestions like "Your margin is high" or
 * "Your LP is out of range."
 */

import type { Provider, ProviderResult } from '@elizaos/core';
import { getpacific, checkReady } from '../services/lpcli.service.js';

export const portfolioProvider: Provider = {
  name: 'PORTFOLIO_STATE',
  description: 'Current DeFi portfolio: perps positions, open orders, account balance.',
  dynamic: true,
  position: -50,

  get: async (_runtime, _message, _state): Promise<ProviderResult> => {
    const readiness = await checkReady();
    if (!readiness.ready) {
      return {
        text: 'Wallet not connected. Portfolio data unavailable.',
        values: { walletReady: false },
        data: {},
      };
    }

    const address = readiness.address!;
    const client = getpacific();

    try {
      const [account, positions, orders, prices] = await Promise.all([
        client.getAccountInfo(address).catch(() => null),
        client.getPositions(address).catch(() => []),
        client.getOpenOrders(address).catch(() => []),
        client.getPrices().catch(() => []),
      ]);

      const priceMap = new Map(prices.map(p => [p.symbol, parseFloat(p.mark)]));
      let totalPnl = 0;

      const positionSummaries = positions.map(pos => {
        const side = pos.side === 'bid' ? 'LONG' : 'SHORT';
        const size = parseFloat(pos.amount);
        const entry = parseFloat(pos.entry_price);
        const mark = priceMap.get(pos.symbol) ?? entry;
        const direction = pos.side === 'bid' ? 1 : -1;
        const pnl = (mark - entry) * size * direction;
        totalPnl += pnl;
        return `${pos.symbol} ${side} ${size} (entry $${entry}, mark $${mark}, PnL ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)})`;
      });

      const equity = account ? parseFloat(account.account_equity) : 0;
      const margin = account ? parseFloat(account.total_margin_used) : 0;
      const utilization = equity > 0 ? (margin / equity * 100).toFixed(1) : '0';

      const parts: string[] = [];
      if (account) {
        parts.push(`Account equity: $${equity.toFixed(2)}, margin used: $${margin.toFixed(2)} (${utilization}% utilization)`);
      }
      if (positionSummaries.length > 0) {
        parts.push(`Open positions: ${positionSummaries.join('; ')}. Total PnL: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`);
      }
      if (orders.length > 0) {
        parts.push(`${orders.length} open order(s)`);
      }
      if (parts.length === 0) {
        parts.push('No open positions or orders.');
      }

      return {
        text: parts.join('. '),
        values: {
          walletReady: true,
          walletAddress: address,
          perpsPositionCount: positions.length,
          perpsEquity: equity,
          marginUtilization: parseFloat(utilization),
          totalPnl,
        },
        data: { account, positions, orders },
      };
    } catch {
      return {
        text: 'Could not fetch portfolio data.',
        values: { walletReady: true, walletAddress: address },
        data: {},
      };
    }
  },
};
