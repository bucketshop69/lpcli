import type { Action, ActionResult, HandlerCallback } from '@elizaos/core';
import { setPositionTPSL } from '@lpcli/core';
import { requireWallet, getPacifica } from '../services/lpcli.service.js';

export const perpsStopLossAction: Action = {
  name: 'PERPS_SET_SL',
  similes: ['SET_SL', 'STOP_LOSS', 'PROTECT_POSITION', 'SET_STOP', 'STOPLOSS'],
  description: 'Set a stop-loss on an existing perpetual position.',
  validate: async (_runtime, message) => {
    const text = message.content.text?.toUpperCase() || '';
    return text.includes('STOP') || text.includes('SL') || text.includes('PROTECT');
  },
  handler: async (_runtime, message, _state, _options, callback): Promise<ActionResult> => {
    const text = message.content.text || '';
    const upper = text.toUpperCase();

    const symbols = ['SOL', 'BTC', 'ETH', 'SUI', 'BONK', 'WIF', 'JUP', 'RNDR', 'PYTH', 'JTO', 'W', 'TNSR'];
    const symbol = symbols.find(s => upper.includes(s));
    if (!symbol) {
      return { success: false, error: 'Please specify which position (e.g. "set stop loss at $75 for SOL").' };
    }

    const priceMatch = text.match(/\$?([\d,]+\.?\d*)/);
    const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : 0;
    if (price <= 0) {
      return { success: false, error: 'Please specify the stop-loss price (e.g. "SL at $75").' };
    }

    const lpcli = await requireWallet();
    const wallet = await lpcli.getWallet();

    await callback?.({ text: `Setting stop-loss at $${price.toLocaleString()} for ${symbol}...` } as Parameters<HandlerCallback>[0]);

    await setPositionTPSL(wallet, {
      symbol,
      stopLoss: { stopPrice: price.toString() },
    });

    const resultText = `Stop-loss set at $${price.toLocaleString()} for ${symbol}.`;
    await callback?.({ text: resultText } as Parameters<HandlerCallback>[0]);

    return { success: true, text: resultText, data: { symbol, stopLossPrice: price } };
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: 'Set stop loss at $75 for SOL' } },
      { name: 'lpcli', content: { text: 'Setting stop-loss at $75 for your SOL position.' } },
    ],
  ],
};
