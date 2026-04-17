import type { Action, ActionResult, HandlerCallback } from '@elizaos/core';
import { getpacific, requireWallet } from '../services/lpcli.service.js';

export const perpsPositionsAction: Action = {
  name: 'PERPS_POSITIONS',
  similes: ['MY_TRADES', 'OPEN_TRADES', 'PERPS_PNL', 'SHOW_POSITIONS', 'CHECK_POSITIONS', 'HOW_ARE_MY_POSITIONS'],
  description: 'Show open perpetual positions with live PnL calculations.',
  validate: async () => true,
  handler: async (_runtime, _message, _state, _options, callback): Promise<ActionResult> => {
    const lpcli = await requireWallet();
    const wallet = await lpcli.getWallet();
    const address = wallet.getPublicKey().toBase58();
    const client = getpacific();

    const [positions, prices, orders] = await Promise.all([
      client.getPositions(address),
      client.getPrices(),
      client.getOpenOrders(address),
    ]);

    if (positions.length === 0 && orders.length === 0) {
      const text = 'No open positions or orders.';
      await callback?.({ text } as Parameters<HandlerCallback>[0]);
      return { success: true, text };
    }

    const priceMap = new Map(prices.map(p => [p.symbol, parseFloat(p.mark)]));
    const lines: string[] = [];
    let totalPnl = 0;

    if (positions.length > 0) {
      lines.push(`Open Positions (${positions.length}):`);
      for (const pos of positions) {
        const side = pos.side === 'bid' ? 'LONG' : 'SHORT';
        const size = parseFloat(pos.amount);
        const entry = parseFloat(pos.entry_price);
        const mark = priceMap.get(pos.symbol) ?? entry;
        const direction = pos.side === 'bid' ? 1 : -1;
        const pnl = (mark - entry) * size * direction;
        const pnlPct = entry > 0 && size > 0 ? (pnl / (entry * size)) * 100 : 0;
        totalPnl += pnl;

        const pnlSign = pnl >= 0 ? '+' : '';
        lines.push(`  ${pos.symbol} ${side} ${size} — Entry: $${entry.toLocaleString()} | Mark: $${mark.toLocaleString()} | PnL: ${pnlSign}$${pnl.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)`);
      }
      const totalSign = totalPnl >= 0 ? '+' : '';
      lines.push(`  Total PnL: ${totalSign}$${totalPnl.toFixed(2)}`);
    }

    if (orders.length > 0) {
      lines.push('');
      lines.push(`Open Orders (${orders.length}):`);
      for (const o of orders) {
        const side = o.side === 'bid' ? 'BUY' : 'SELL';
        const type = o.order_type.toUpperCase();
        const qty = o.initial_amount && o.initial_amount !== '0' ? o.initial_amount : 'full';
        const priceVal = o.stop_price && o.stop_price !== '0' ? o.stop_price : o.price;
        const priceStr = priceVal && priceVal !== '0' ? `@ $${priceVal}` : '';
        lines.push(`  ${o.symbol} ${side} ${type} ${qty} ${priceStr}`);
      }
    }

    const text = lines.join('\n');
    await callback?.({ text } as Parameters<HandlerCallback>[0]);

    return {
      success: true,
      text,
      data: { positions, orders, totalPnl },
    };
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: 'How are my positions?' } },
      { name: 'lpcli', content: { text: 'Let me check your open perps positions and PnL.' } },
    ],
  ],
};
