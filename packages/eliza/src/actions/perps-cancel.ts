import type { Action, ActionResult, HandlerCallback } from '@elizaos/core';
import { cancelOrder, cancelStopOrder, cancelAllOrders } from '@lpcli/core';
import { requireWallet, getpacific } from '../services/lpcli.service.js';

export const perpsCancelAction: Action = {
  name: 'PERPS_CANCEL_ORDERS',
  similes: ['CANCEL_ORDERS', 'CANCEL_ORDER', 'REMOVE_ORDERS', 'CANCEL_ALL_ORDERS', 'CANCEL_SL', 'CANCEL_TP'],
  description: 'Cancel open orders on pacific perpetuals. Can cancel all orders or filter by symbol.',
  validate: async (_runtime, message) => {
    const text = message.content.text?.toUpperCase() || '';
    return text.includes('CANCEL');
  },
  handler: async (_runtime, message, _state, _options, callback): Promise<ActionResult> => {
    const text = message.content.text?.toUpperCase() || '';

    const symbols = ['SOL', 'BTC', 'ETH', 'SUI', 'BONK', 'WIF', 'JUP', 'RNDR', 'PYTH', 'JTO', 'W', 'TNSR'];
    const symbol = symbols.find(s => text.includes(s));

    const lpcli = await requireWallet();
    const wallet = await lpcli.getWallet();
    const address = wallet.getPublicKey().toBase58();
    const client = getpacific();

    const allOrders = await client.getOpenOrders(address);
    const orders = symbol
      ? allOrders.filter(o => o.symbol.toUpperCase() === symbol)
      : allOrders;

    if (orders.length === 0) {
      const noOrders = symbol ? `No open orders for ${symbol}.` : 'No open orders to cancel.';
      await callback?.({ text: noOrders } as Parameters<HandlerCallback>[0]);
      return { success: true, text: noOrders };
    }

    await callback?.({ text: `Cancelling ${orders.length} order(s)${symbol ? ` for ${symbol}` : ''}...` } as Parameters<HandlerCallback>[0]);

    if (!symbol && orders.every(o => !o.order_type.toLowerCase().includes('stop'))) {
      await cancelAllOrders(wallet, client);
    } else {
      for (const o of orders) {
        const isStop = o.order_type.toLowerCase().includes('stop') || o.order_type.toLowerCase().includes('take_profit');
        if (isStop) {
          await cancelStopOrder(wallet, o.order_id, o.symbol, client);
        } else {
          await cancelOrder(wallet, o.order_id, o.symbol, client);
        }
      }
    }

    const resultText = `Cancelled ${orders.length} order(s)${symbol ? ` for ${symbol}` : ''}.`;
    await callback?.({ text: resultText } as Parameters<HandlerCallback>[0]);

    return { success: true, text: resultText, data: { cancelled: orders.length, symbol } };
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: 'Cancel my SOL orders' } },
      { name: 'lpcli', content: { text: 'Cancelling all open orders for SOL.' } },
    ],
    [
      { name: '{{user1}}', content: { text: 'Cancel all orders' } },
      { name: 'lpcli', content: { text: 'Cancelling all open orders.' } },
    ],
  ],
};
