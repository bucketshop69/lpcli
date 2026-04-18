/**
 * Market Provider — injects live market prices and funding rates into context.
 */

import type { Provider, ProviderResult } from '@elizaos/core';
import { getPacifica } from '../services/lpcli.service.js';

export const marketProvider: Provider = {
  name: 'MARKET_DATA',
  description: 'Live perpetual market prices, funding rates, and 24h volume.',
  dynamic: true,
  position: -40,

  get: async (): Promise<ProviderResult> => {
    try {
      const client = getPacifica();
      const prices = await client.getPrices();

      // Top markets by volume
      const sorted = [...prices].sort((a, b) => parseFloat(b.volume_24h) - parseFloat(a.volume_24h));
      const top = sorted.slice(0, 5);

      const lines = top.map(p => {
        const mark = parseFloat(p.mark).toLocaleString();
        const funding = (parseFloat(p.funding) * 100).toFixed(4);
        return `${p.symbol}: $${mark} (funding ${funding}%)`;
      });

      return {
        text: `Market prices: ${lines.join(', ')}`,
        values: Object.fromEntries(top.map(p => [`${p.symbol.toLowerCase()}Price`, parseFloat(p.mark)])),
        data: { prices },
      };
    } catch {
      return { text: 'Market data unavailable.', values: {}, data: {} };
    }
  },
};
