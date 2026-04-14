import type { Action, ActionResult, HandlerCallback } from '@elizaos/core';
import { buildDepositTransaction, PACIFICA_MIN_DEPOSIT_USDC } from '@lpcli/core';
import { requireWallet } from '../services/lpcli.service.js';

export const perpsDepositAction: Action = {
  name: 'PERPS_DEPOSIT',
  similes: ['DEPOSIT', 'FUND_ACCOUNT', 'ADD_COLLATERAL', 'DEPOSIT_USDC', 'ADD_FUNDS'],
  description: `Deposit USDC to Pacifica perpetuals account. Minimum $${PACIFICA_MIN_DEPOSIT_USDC}.`,
  validate: async (_runtime, message) => {
    const text = message.content.text?.toUpperCase() || '';
    return text.includes('DEPOSIT') || text.includes('FUND') || text.includes('COLLATERAL');
  },
  handler: async (_runtime, message, _state, _options, callback): Promise<ActionResult> => {
    const text = message.content.text || '';

    const amountMatch = text.match(/(\d+\.?\d*)/);
    const amount = amountMatch ? parseFloat(amountMatch[1]) : 0;
    if (amount < PACIFICA_MIN_DEPOSIT_USDC) {
      return { success: false, error: `Minimum deposit is $${PACIFICA_MIN_DEPOSIT_USDC} USDC.` };
    }

    const lpcli = await requireWallet();
    const wallet = await lpcli.getWallet();
    const connection = wallet.getConnection();

    await callback?.({ text: `Depositing $${amount} USDC to Pacifica...` } as Parameters<HandlerCallback>[0]);

    const tx = await buildDepositTransaction(wallet.getPublicKey(), amount, connection);
    const signedTx = await wallet.signTx(tx);
    const sig = await connection.sendRawTransaction(signedTx.serialize());
    await connection.confirmTransaction(sig, 'confirmed');

    const resultText = `Deposited $${amount} USDC to Pacifica. TX: ${sig}`;
    await callback?.({ text: resultText } as Parameters<HandlerCallback>[0]);

    return { success: true, text: resultText, data: { amount, tx: sig } };
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: 'Deposit 50 USDC to Pacifica' } },
      { name: 'lpcli', content: { text: 'Depositing $50 USDC to your Pacifica account.' } },
    ],
  ],
};
