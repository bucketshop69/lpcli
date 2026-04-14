import type { Action, ActionResult, HandlerCallback } from '@elizaos/core';
import { requestWithdrawal } from '@lpcli/core';
import { requireWallet } from '../services/lpcli.service.js';

export const perpsWithdrawAction: Action = {
  name: 'PERPS_WITHDRAW',
  similes: ['WITHDRAW', 'PULL_FUNDS', 'WITHDRAW_USDC', 'TAKE_OUT', 'WITHDRAW_COLLATERAL'],
  description: 'Withdraw USDC from Pacifica perpetuals account.',
  validate: async (_runtime, message) => {
    const text = message.content.text?.toUpperCase() || '';
    return text.includes('WITHDRAW') || text.includes('PULL');
  },
  handler: async (_runtime, message, _state, _options, callback): Promise<ActionResult> => {
    const text = message.content.text || '';

    const amountMatch = text.match(/(\d+\.?\d*)/);
    const amount = amountMatch ? parseFloat(amountMatch[1]) : 0;
    if (amount <= 0) {
      return { success: false, error: 'Please specify the amount to withdraw (e.g. "withdraw 20 USDC").' };
    }

    const lpcli = await requireWallet();
    const wallet = await lpcli.getWallet();

    await callback?.({ text: `Withdrawing $${amount} USDC from Pacifica...` } as Parameters<HandlerCallback>[0]);

    await requestWithdrawal(wallet, amount);

    const resultText = `Withdrawal of $${amount} USDC requested. Funds will arrive in your wallet shortly.`;
    await callback?.({ text: resultText } as Parameters<HandlerCallback>[0]);

    return { success: true, text: resultText, data: { amount } };
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: 'Withdraw 20 USDC from Pacifica' } },
      { name: 'lpcli', content: { text: 'Withdrawing $20 USDC from your Pacifica account.' } },
    ],
  ],
};
