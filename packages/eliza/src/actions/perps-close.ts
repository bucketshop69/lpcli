import type { Action, ActionResult, HandlerCallback } from '@elizaos/core';
import { closePosition } from '@lpcli/core';
import { requireWallet, getpacific } from '../services/lpcli.service.js';

export const perpsCloseAction: Action = {
  name: 'PERPS_CLOSE',
  similes: ['CLOSE_TRADE', 'EXIT_TRADE', 'FLATTEN', 'CLOSE_POSITION', 'CLOSE_PERPS'],
  description: 'Close an open perpetual position by symbol.',
  validate: async (_runtime, message) => {
    const text = message.content.text?.toUpperCase() || '';
    return text.includes('CLOSE') || text.includes('EXIT') || text.includes('FLATTEN');
  },
  handler: async (_runtime, message, _state, _options, callback): Promise<ActionResult> => {
    const text = message.content.text?.toUpperCase() || '';

    const symbols = ['SOL', 'BTC', 'ETH', 'SUI', 'BONK', 'WIF', 'JUP', 'RNDR', 'PYTH', 'JTO', 'W', 'TNSR'];
    const symbol = symbols.find(s => text.includes(s));
    if (!symbol) {
      return { success: false, error: 'Please specify which position to close (e.g. "close SOL").' };
    }

    const lpcli = await requireWallet();
    const wallet = await lpcli.getWallet();
    const client = getpacific();

    await callback?.({ text: `Closing ${symbol} position...` } as Parameters<HandlerCallback>[0]);

    const result = await closePosition(wallet, symbol, client);
    if (!result) {
      return { success: false, error: `No open position found for ${symbol}.` };
    }
    const resultText = `${symbol} position closed. Order ID: ${result.orderId}.`;
    await callback?.({ text: resultText } as Parameters<HandlerCallback>[0]);

    return {
      success: true,
      text: resultText,
      data: { orderId: result.orderId, symbol },
    };
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: 'Close my SOL position' } },
      { name: 'lpcli', content: { text: 'Closing your SOL perpetual position.' } },
    ],
  ],
};
