import type { Action, ActionResult, HandlerCallback } from '@elizaos/core';
import { requireWallet } from '../services/lpcli.service.js';

export const lpClaimAction: Action = {
  name: 'CLAIM_LP_FEES',
  similes: ['CLAIM_FEES', 'COLLECT_FEES', 'HARVEST', 'HARVEST_FEES', 'CLAIM_LP'],
  description: 'Claim accrued fees from a Meteora DLMM position without closing it.',
  validate: async (_runtime, message) => {
    const text = message.content.text?.toUpperCase() || '';
    return text.includes('CLAIM') || text.includes('HARVEST') || text.includes('COLLECT');
  },
  handler: async (_runtime, message, _state, _options, callback): Promise<ActionResult> => {
    const text = message.content.text || '';

    const addrMatch = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
    if (!addrMatch) {
      return { success: false, error: 'Please provide the position address. Use "show LP positions" to find it.' };
    }
    const positionAddress = addrMatch[0];

    const lpcli = await requireWallet();
    const dlmm = lpcli.dlmm!;

    await callback?.({ text: `Claiming fees from position ${positionAddress.slice(0, 8)}...` } as Parameters<HandlerCallback>[0]);

    const result = await dlmm.claimFees(positionAddress);

    const resultText = [
      `Fees claimed!`,
      `  Token X: ${result.claimedX}`,
      `  Token Y: ${result.claimedY}`,
      result.tx ? `  TX: ${result.tx}` : '',
    ].filter(Boolean).join('\n');

    await callback?.({ text: resultText } as Parameters<HandlerCallback>[0]);

    return {
      success: true,
      text: resultText,
      data: { claimedX: result.claimedX, claimedY: result.claimedY, tx: result.tx },
    };
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: 'Claim fees from my LP position' } },
      { name: 'lpcli', content: { text: 'Claiming accrued fees from your position.' } },
    ],
  ],
};
