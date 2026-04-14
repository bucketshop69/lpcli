import type { Action, ActionResult, HandlerCallback } from '@elizaos/core';
import { createMarketOrder, roundToLotSize } from '@lpcli/core';
import { requireWallet, getPacifica } from '../services/lpcli.service.js';

export const perpsTradeAction: Action = {
  name: 'PERPS_TRADE',
  similes: ['LONG', 'SHORT', 'BUY_PERPS', 'SELL_PERPS', 'OPEN_TRADE', 'PLACE_TRADE', 'GO_LONG', 'GO_SHORT'],
  description: 'Place a market order on Pacifica perpetuals. Specify symbol, direction (long/short), and size. Example: "Long 0.5 SOL"',
  validate: async (_runtime, message) => {
    const text = message.content.text?.toUpperCase() || '';
    return text.includes('LONG') || text.includes('SHORT') || text.includes('TRADE');
  },
  handler: async (_runtime, message, _state, _options, callback): Promise<ActionResult> => {
    const text = message.content.text || '';
    const upper = text.toUpperCase();

    // Parse direction
    const side = upper.includes('SHORT') ? 'ask' : 'bid';
    const directionLabel = side === 'bid' ? 'LONG' : 'SHORT';

    // Parse symbol
    const symbols = ['SOL', 'BTC', 'ETH', 'SUI', 'BONK', 'WIF', 'JUP', 'RNDR', 'PYTH', 'JTO', 'W', 'TNSR'];
    const symbol = symbols.find(s => upper.includes(s));
    if (!symbol) {
      return { success: false, error: 'Could not determine which market to trade. Please specify a symbol (e.g. SOL, BTC, ETH).' };
    }

    // Parse size
    const sizeMatch = text.match(/(\d+\.?\d*)\s*/);
    const rawSize = sizeMatch ? parseFloat(sizeMatch[1]) : 0;
    if (rawSize <= 0) {
      return { success: false, error: 'Could not determine trade size. Please specify a size (e.g. "Long 0.5 SOL").' };
    }

    const lpcli = await requireWallet();
    const wallet = await lpcli.getWallet();
    const client = getPacifica();

    // Validate and round to lot size
    const market = await client.getMarkets().then(ms => ms.find(m => m.symbol === symbol));
    if (!market) {
      return { success: false, error: `Market ${symbol} not found.` };
    }
    const size = roundToLotSize(rawSize, market);

    // Get current price for display
    const prices = await client.getPrices();
    const price = prices.find(p => p.symbol === symbol);
    const markPrice = price ? `$${parseFloat(price.mark).toLocaleString()}` : 'N/A';

    await callback?.({ text: `Placing ${directionLabel} ${size} ${symbol} at mark ${markPrice}...` } as Parameters<HandlerCallback>[0]);

    const result = await createMarketOrder(wallet, {
      symbol,
      side: side as 'bid' | 'ask',
      amount: size,
    }, client);

    const resultText = `${directionLabel} ${size} ${symbol} placed. Order ID: ${result.orderId}. Mark price: ${markPrice}.`;
    await callback?.({ text: resultText } as Parameters<HandlerCallback>[0]);

    return {
      success: true,
      text: resultText,
      data: { orderId: result.orderId, symbol, side, size, markPrice },
    };
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: 'Long 0.5 SOL' } },
      { name: 'lpcli', content: { text: 'Placing a long position for 0.5 SOL on Pacifica.' } },
    ],
    [
      { name: '{{user1}}', content: { text: 'Short 0.01 BTC' } },
      { name: 'lpcli', content: { text: 'Opening a short for 0.01 BTC.' } },
    ],
  ],
};
