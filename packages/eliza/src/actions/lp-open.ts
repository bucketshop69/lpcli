import type { Action, ActionResult, HandlerCallback } from '@elizaos/core';
import { requireWallet, getLpcli } from '../services/lpcli.service.js';

export const lpOpenAction: Action = {
  name: 'OPEN_LP_POSITION',
  similes: ['ADD_LIQUIDITY', 'PROVIDE_LIQUIDITY', 'OPEN_LP', 'LP_OPEN', 'OPEN_POSITION_LP'],
  description: 'Open a Meteora DLMM liquidity position. Specify pool address and optional amounts/strategy.',
  validate: async (_runtime, message) => {
    const text = message.content.text?.toUpperCase() || '';
    return (text.includes('OPEN') || text.includes('ADD') || text.includes('PROVIDE')) &&
           (text.includes('LP') || text.includes('LIQUIDITY') || text.includes('POSITION'));
  },
  handler: async (_runtime, message, _state, _options, callback): Promise<ActionResult> => {
    const text = message.content.text || '';

    // Extract pool address (base58 string, ~44 chars)
    const addrMatch = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
    if (!addrMatch) {
      return { success: false, error: 'Please provide the pool address. Use "discover pools" to find one first.' };
    }
    const poolAddress = addrMatch[0];

    // Extract strategy
    const upper = text.toUpperCase();
    const strategy = upper.includes('CURVE') ? 'curve' :
      upper.includes('BIDASK') || upper.includes('BID ASK') ? 'bidask' : 'spot';

    // Extract amount (in token X)
    const amountMatch = text.match(/(\d+\.?\d*)\s*(sol|usdc|token)?/i);
    const amountX = amountMatch ? parseFloat(amountMatch[1]) : undefined;

    // Extract width
    const widthMatch = text.match(/(\d+)\s*bins?/i);
    const widthBins = widthMatch ? parseInt(widthMatch[1]) : undefined;

    const lpcli = await requireWallet();
    const wallet = await lpcli.getWallet();
    const dlmm = lpcli.dlmm!;

    await callback?.({ text: `Opening ${strategy} LP position on pool ${poolAddress.slice(0, 8)}...` } as Parameters<HandlerCallback>[0]);

    const result = await dlmm.openPosition({
      pool: poolAddress,
      amountX,
      strategy: strategy as 'spot' | 'curve' | 'bidask',
      widthBins,
    });

    const resultText = [
      `LP position opened!`,
      `  Position: ${result.position}`,
      `  Strategy: ${strategy}`,
      `  Range: $${result.range_low.toFixed(4)} — $${result.range_high.toFixed(4)}`,
      `  Deposited: ${result.deposited_x} X + ${result.deposited_y} Y`,
      `  TX: ${result.tx}`,
    ].join('\n');

    await callback?.({ text: resultText } as Parameters<HandlerCallback>[0]);

    return {
      success: true,
      text: resultText,
      data: { position: result.position, tx: result.tx },
    };
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: 'Open LP position on pool 5rG7xQ3d with spot strategy' } },
      { name: 'lpcli', content: { text: 'Opening a spot LP position on that pool.' } },
    ],
  ],
};
