import type { Action, ActionResult, HandlerCallback } from '@elizaos/core';
import { getpacific } from '../services/lpcli.service.js';

export const perpsMarketsAction: Action = {
  name: 'PERPS_LIST_MARKETS',
  similes: ['SHOW_MARKETS', 'WHAT_CAN_I_TRADE', 'PERPS_MARKETS', 'AVAILABLE_PAIRS', 'LIST_MARKETS'],
  description: 'List available perpetual futures markets with prices, funding rates, and specs.',
  validate: async () => true,
  handler: async (_runtime, _message, _state, _options, callback): Promise<ActionResult> => {
    const client = getpacific();
    const [markets, prices] = await Promise.all([
      client.getMarkets(),
      client.getPrices(),
    ]);

    const priceMap = new Map(prices.map(p => [p.symbol, p]));

    const lines: string[] = ['Available Perpetual Markets:\n'];
    for (const m of markets) {
      const p = priceMap.get(m.symbol);
      const mark = p ? `$${parseFloat(p.mark).toLocaleString()}` : 'N/A';
      const funding = p ? `${(parseFloat(p.funding) * 100).toFixed(4)}%` : 'N/A';
      const vol = p ? `$${(parseFloat(p.volume_24h) / 1e6).toFixed(1)}M` : 'N/A';
      lines.push(`${m.symbol} — Mark: ${mark} | Funding: ${funding} | 24h Vol: ${vol} | Max Leverage: ${m.max_leverage}x`);
    }

    const text = lines.join('\n');
    await callback?.({ text } as Parameters<HandlerCallback>[0]);

    return {
      success: true,
      text,
      data: { markets, prices },
    };
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: 'What markets can I trade?' } },
      { name: 'lpcli', content: { text: 'Let me check the available perpetual markets for you.' } },
    ],
  ],
};
