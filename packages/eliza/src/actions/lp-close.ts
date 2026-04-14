import type { Action, ActionResult, HandlerCallback } from '@elizaos/core';
import { requireWallet } from '../services/lpcli.service.js';

export const lpCloseAction: Action = {
  name: 'CLOSE_LP_POSITION',
  similes: ['REMOVE_LIQUIDITY', 'CLOSE_LP', 'EXIT_LP', 'WITHDRAW_LP', 'CLOSE_POSITION_LP'],
  description: 'Close a Meteora DLMM liquidity position and claim all fees.',
  validate: async (_runtime, message) => {
    const text = message.content.text?.toUpperCase() || '';
    return (text.includes('CLOSE') || text.includes('REMOVE') || text.includes('EXIT') || text.includes('WITHDRAW')) &&
           (text.includes('LP') || text.includes('LIQUIDITY') || text.includes('POSITION'));
  },
  handler: async (_runtime, message, _state, _options, callback): Promise<ActionResult> => {
    const text = message.content.text || '';

    // Extract position address
    const addrMatch = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
    if (!addrMatch) {
      return { success: false, error: 'Please provide the position address. Use "show LP positions" to find it.' };
    }
    const positionAddress = addrMatch[0];

    const lpcli = await requireWallet();
    const dlmm = lpcli.dlmm!;

    await callback?.({ text: `Closing LP position ${positionAddress.slice(0, 8)}...` } as Parameters<HandlerCallback>[0]);

    const result = await dlmm.closePosition(positionAddress);

    const resultText = [
      `LP position closed!`,
      `  Withdrawn: ${result.withdrawn_x} X + ${result.withdrawn_y} Y`,
      `  Fees claimed: ${result.claimed_fees_x} X + ${result.claimed_fees_y} Y`,
      `  TX: ${result.tx}`,
    ].join('\n');

    await callback?.({ text: resultText } as Parameters<HandlerCallback>[0]);

    return {
      success: true,
      text: resultText,
      data: { tx: result.tx },
    };
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: 'Close my LP position 5rG7xQ3d' } },
      { name: 'lpcli', content: { text: 'Closing that LP position and claiming fees.' } },
    ],
  ],
};
