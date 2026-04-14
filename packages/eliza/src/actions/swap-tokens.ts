import type { Action, ActionResult, HandlerCallback } from '@elizaos/core';
import { jupiterSwap } from '@lpcli/core';
import { requireWallet } from '../services/lpcli.service.js';

// Common token mints
const TOKEN_MINTS: Record<string, string> = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  JTO: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',
  PYTH: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
};

export const swapTokensAction: Action = {
  name: 'SWAP_TOKENS',
  similes: ['SWAP', 'EXCHANGE', 'CONVERT', 'TRADE_TOKENS', 'BUY_TOKEN', 'SELL_TOKEN'],
  description: 'Swap tokens via Jupiter. Example: "Swap 1 SOL to USDC" or "Buy 100 USDC worth of SOL".',
  validate: async (_runtime, message) => {
    const text = message.content.text?.toUpperCase() || '';
    return text.includes('SWAP') || text.includes('EXCHANGE') || text.includes('CONVERT');
  },
  handler: async (_runtime, message, _state, _options, callback): Promise<ActionResult> => {
    const text = message.content.text || '';
    const upper = text.toUpperCase();

    // Parse: "swap 1 SOL to USDC" or "swap SOL to USDC 1"
    const tokenNames = Object.keys(TOKEN_MINTS);
    const foundTokens = tokenNames.filter(t => upper.includes(t));

    if (foundTokens.length < 2) {
      return { success: false, error: 'Please specify both tokens. Example: "Swap 1 SOL to USDC".' };
    }

    // First token mentioned is input, second is output
    const inputToken = foundTokens[0];
    const outputToken = foundTokens[1];

    const inputMint = TOKEN_MINTS[inputToken];
    const outputMint = TOKEN_MINTS[outputToken];

    // Parse amount
    const amountMatch = text.match(/(\d+\.?\d*)/);
    const amount = amountMatch ? parseFloat(amountMatch[1]) : 0;
    if (amount <= 0) {
      return { success: false, error: 'Please specify the amount to swap (e.g. "Swap 1 SOL to USDC").' };
    }

    // Convert to raw amount (assume 9 decimals for SOL, 6 for stables)
    const decimals = inputToken === 'SOL' ? 9 : 6;
    const rawAmount = Math.round(amount * 10 ** decimals);

    const lpcli = await requireWallet();
    const wallet = await lpcli.getWallet();

    await callback?.({ text: `Swapping ${amount} ${inputToken} → ${outputToken} via Jupiter...` } as Parameters<HandlerCallback>[0]);

    const result = await jupiterSwap({
      inputMint,
      outputMint,
      amount: rawAmount,
    }, wallet);

    const outAmount = result.outAmount
      ? (parseInt(result.outAmount) / 10 ** (outputToken === 'SOL' ? 9 : 6)).toFixed(6)
      : 'N/A';

    const resultText = `Swapped ${amount} ${inputToken} → ${outAmount} ${outputToken}. TX: ${result.signature}`;
    await callback?.({ text: resultText } as Parameters<HandlerCallback>[0]);

    return {
      success: true,
      text: resultText,
      data: { inputToken, outputToken, amount, outAmount, tx: result.signature },
    };
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: 'Swap 1 SOL to USDC' } },
      { name: 'lpcli', content: { text: 'Swapping 1 SOL to USDC via Jupiter.' } },
    ],
  ],
};
