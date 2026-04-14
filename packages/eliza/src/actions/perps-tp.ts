import type { Action, ActionResult, HandlerCallback } from '@elizaos/core';
import { setPositionTPSL } from '@lpcli/core';
import { requireWallet } from '../services/lpcli.service.js';

export const perpsTakeProfitAction: Action = {
  name: 'PERPS_SET_TP',
  similes: ['SET_TP', 'TAKE_PROFIT', 'TARGET_PRICE', 'PROFIT_TARGET', 'TAKEPROFIT'],
  description: 'Set a take-profit on an existing perpetual position.',
  validate: async (_runtime, message) => {
    const text = message.content.text?.toUpperCase() || '';
    return text.includes('TAKE PROFIT') || text.includes('TP') || text.includes('TARGET');
  },
  handler: async (_runtime, message, _state, _options, callback): Promise<ActionResult> => {
    const text = message.content.text || '';
    const upper = text.toUpperCase();

    const symbols = ['SOL', 'BTC', 'ETH', 'SUI', 'BONK', 'WIF', 'JUP', 'RNDR', 'PYTH', 'JTO', 'W', 'TNSR'];
    const symbol = symbols.find(s => upper.includes(s));
    if (!symbol) {
      return { success: false, error: 'Please specify which position (e.g. "set take profit at $100 for SOL").' };
    }

    const priceMatch = text.match(/\$?([\d,]+\.?\d*)/);
    const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : 0;
    if (price <= 0) {
      return { success: false, error: 'Please specify the take-profit price (e.g. "TP at $100").' };
    }

    const lpcli = await requireWallet();
    const wallet = await lpcli.getWallet();

    await callback?.({ text: `Setting take-profit at $${price.toLocaleString()} for ${symbol}...` } as Parameters<HandlerCallback>[0]);

    await setPositionTPSL(wallet, {
      symbol,
      takeProfit: { stopPrice: price.toString() },
    });

    const resultText = `Take-profit set at $${price.toLocaleString()} for ${symbol}.`;
    await callback?.({ text: resultText } as Parameters<HandlerCallback>[0]);

    return { success: true, text: resultText, data: { symbol, takeProfitPrice: price } };
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: 'Set take profit at $100 for SOL' } },
      { name: 'lpcli', content: { text: 'Setting take-profit at $100 for your SOL position.' } },
    ],
  ],
};
