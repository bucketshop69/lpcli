import type { Action, ActionResult, HandlerCallback } from '@elizaos/core';
import { getPacifica, requireWallet } from '../services/lpcli.service.js';

export const perpsAccountAction: Action = {
  name: 'PERPS_ACCOUNT',
  similes: ['PERPS_BALANCE', 'MARGIN_STATUS', 'TRADING_ACCOUNT', 'ACCOUNT_INFO', 'HOW_MUCH_MARGIN'],
  description: 'Show Pacifica perpetuals account balance, equity, margin, and utilization.',
  validate: async () => true,
  handler: async (_runtime, _message, _state, _options, callback): Promise<ActionResult> => {
    const lpcli = await requireWallet();
    const wallet = await lpcli.getWallet();
    const address = wallet.getPublicKey().toBase58();
    const client = getPacifica();

    const info = await client.getAccountInfo(address);

    const equity = parseFloat(info.account_equity);
    const margin = parseFloat(info.total_margin_used);
    const utilization = equity > 0 ? (margin / equity * 100).toFixed(1) : '0.0';

    const lines = [
      `Pacifica Account: ${address}`,
      `  Balance:             $${parseFloat(info.balance).toFixed(2)}`,
      `  Account Equity:      $${equity.toFixed(2)}`,
      `  Available to Spend:  $${parseFloat(info.available_to_spend).toFixed(2)}`,
      `  Available to Withdraw: $${parseFloat(info.available_to_withdraw).toFixed(2)}`,
      `  Margin Used:         $${margin.toFixed(2)}`,
      `  Margin Utilization:  ${utilization}%`,
      `  Positions:           ${info.positions_count}`,
      `  Open Orders:         ${info.orders_count + info.stop_orders_count}`,
    ];

    const text = lines.join('\n');
    await callback?.({ text } as Parameters<HandlerCallback>[0]);

    return {
      success: true,
      text,
      data: { account: info },
    };
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: "What's my account balance?" } },
      { name: 'lpcli', content: { text: 'Checking your Pacifica account balance and margin status.' } },
    ],
  ],
};
