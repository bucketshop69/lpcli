import type { Action, ActionResult, HandlerCallback } from '@elizaos/core';
import { requireWallet } from '../services/lpcli.service.js';

export const lpPositionsAction: Action = {
  name: 'LP_POSITIONS',
  similes: ['MY_LP', 'LP_POSITIONS', 'LIQUIDITY_POSITIONS', 'DLMM_POSITIONS', 'METEORA_POSITIONS', 'SHOW_LP'],
  description: 'Show open Meteora DLMM liquidity positions with fees earned and range status.',
  validate: async (_runtime, message) => {
    const text = message.content.text?.toUpperCase() || '';
    return text.includes('LP') || text.includes('LIQUIDITY') || text.includes('DLMM') || text.includes('METEORA');
  },
  handler: async (_runtime, _message, _state, _options, callback): Promise<ActionResult> => {
    const lpcli = await requireWallet();
    const wallet = await lpcli.getWallet();
    const dlmm = lpcli.dlmm!;

    await callback?.({ text: 'Fetching your LP positions...' } as Parameters<HandlerCallback>[0]);

    const positions = await dlmm.getPositions(wallet.getPublicKey().toBase58());

    if (positions.length === 0) {
      const text = 'No open LP positions.';
      await callback?.({ text } as Parameters<HandlerCallback>[0]);
      return { success: true, text };
    }

    const lines = [`Open LP Positions (${positions.length}):\n`];
    for (const pos of positions) {
      const status = pos.status === 'in_range' ? 'IN RANGE' :
        pos.status === 'out_of_range_above' ? 'OUT OF RANGE (above)' :
        pos.status === 'out_of_range_below' ? 'OUT OF RANGE (below)' : pos.status.toUpperCase();

      lines.push(`  ${pos.pool_name} — ${status}`);
      lines.push(`    Value: ${pos.current_value_x_ui.toFixed(4)} X + ${pos.current_value_y_ui.toFixed(4)} Y`);
      lines.push(`    Fees: ${pos.fees_earned_x_ui.toFixed(4)} X + ${pos.fees_earned_y_ui.toFixed(4)} Y`);
      lines.push(`    Range: $${pos.range_low.toFixed(4)} — $${pos.range_high.toFixed(4)} | Current: $${pos.current_price.toFixed(4)}`);
      lines.push(`    Address: ${pos.address}`);
    }

    const text = lines.join('\n');
    await callback?.({ text } as Parameters<HandlerCallback>[0]);

    return {
      success: true,
      text,
      data: { positions: positions.map(p => ({ address: p.address, pool: p.pool_name, status: p.status })) },
    };
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: 'Show my LP positions' } },
      { name: 'lpcli', content: { text: 'Fetching your Meteora DLMM positions.' } },
    ],
  ],
};
