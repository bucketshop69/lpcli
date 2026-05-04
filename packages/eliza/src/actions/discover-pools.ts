import type { Action, ActionResult, HandlerCallback } from '@elizaos/core';
import { getLpcli } from '../services/lpcli.service.js';

export const discoverPoolsAction: Action = {
  name: 'DISCOVER_POOLS',
  similes: ['FIND_POOLS', 'BEST_POOLS', 'SEARCH_POOLS', 'TOP_POOLS', 'POOL_RANKINGS', 'LP_POOLS'],
  description: 'Discover and rank the best Meteora DLMM liquidity pools by token. Scored by fee yield, volume, and TVL.',
  validate: async (_runtime, message) => {
    const text = message.content.text?.toUpperCase() || '';
    return text.includes('POOL') || text.includes('LP') || text.includes('LIQUIDITY') || text.includes('DISCOVER');
  },
  handler: async (_runtime, message, _state, _options, callback): Promise<ActionResult> => {
    const text = message.content.text?.toUpperCase() || '';

    // Extract token symbol
    const tokens = ['SOL', 'USDC', 'USDT', 'BTC', 'ETH', 'JUP', 'BONK', 'WIF', 'JTO', 'PYTH'];
    const token = tokens.find(t => text.includes(t)) || 'SOL';

    const lpcli = getLpcli();
    await callback?.({ text: `Searching for the best ${token} DLMM pools...` } as Parameters<HandlerCallback>[0]);

    const pools = (await lpcli.discoverPools(token, {
      defaultSort: 'fee_active_tvl_ratio',
      pageSize: 5,
    })).slice(0, 5);

    if (pools.length === 0) {
      const noResults = `No DLMM pools found for ${token}.`;
      await callback?.({ text: noResults } as Parameters<HandlerCallback>[0]);
      return { success: true, text: noResults };
    }

    const lines = [`Top ${token} DLMM Pools:\n`];
    for (let i = 0; i < pools.length; i++) {
      const p = pools[i];
      const apr = p.fee_active_tvl_ratio > 0 ? `${(p.fee_active_tvl_ratio * 365 * 100).toFixed(0)}%` : 'N/A';
      const tvl = `$${(p.tvl / 1e6).toFixed(1)}M`;
      lines.push(`#${i + 1} ${p.name} — Fee APR: ~${apr} | TVL: ${tvl}`);
      lines.push(`   Address: ${p.pool_address}`);
    }

    const result = lines.join('\n');
    await callback?.({ text: result } as Parameters<HandlerCallback>[0]);

    return {
      success: true,
      text: result,
      data: { pools: pools.map(p => ({ name: p.name, address: p.pool_address, feeApr: p.fee_active_tvl_ratio * 365 })) },
    };
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: 'What are the best SOL pools?' } },
      { name: 'lpcli', content: { text: 'Let me find the top-ranked SOL DLMM pools for you.' } },
    ],
  ],
};
