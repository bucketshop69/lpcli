import type { Action, ActionResult, HandlerCallback } from '@elizaos/core';
import { fetchRSI } from '@lpcli/core';
import type { pacificKlineInterval } from '@lpcli/core';

export const checkRsiAction: Action = {
  name: 'CHECK_RSI',
  similes: ['RSI', 'TECHNICAL_ANALYSIS', 'IS_IT_OVERBOUGHT', 'MOMENTUM', 'RSI_CHECK'],
  description: 'Fetch RSI (Relative Strength Index) for a perpetual market. Helps gauge momentum — overbought above 60, oversold below 40.',
  validate: async (_runtime, message) => {
    const text = message.content.text?.toUpperCase() || '';
    return text.includes('RSI') || text.includes('OVERBOUGHT') || text.includes('OVERSOLD') || text.includes('MOMENTUM');
  },
  handler: async (_runtime, message, _state, _options, callback): Promise<ActionResult> => {
    const text = message.content.text?.toUpperCase() || '';

    // Extract symbol from message
    const symbols = ['SOL', 'BTC', 'ETH', 'SUI', 'BONK', 'WIF', 'JUP', 'RNDR', 'PYTH', 'JTO', 'W', 'TNSR'];
    const symbol = symbols.find(s => text.includes(s)) || 'SOL';

    // Extract timeframe if mentioned
    const tfMatch = text.match(/(\d+[mhd])/i);
    const interval = (tfMatch?.[1]?.toLowerCase() || '15m') as pacificKlineInterval;

    const rsi = await fetchRSI(symbol, interval);

    const zone = rsi.rsi !== null
      ? rsi.rsi > 60 ? 'OVERBOUGHT' : rsi.rsi < 40 ? 'OVERSOLD' : 'NEUTRAL'
      : 'INSUFFICIENT DATA';

    const lines = [
      `${symbol} RSI (${interval}, ${rsi.candleCount} candles):`,
      `  RSI: ${rsi.rsi !== null ? rsi.rsi.toFixed(1) : 'N/A'}`,
      `  Zone: ${zone}`,
      `  Price: $${rsi.price.toLocaleString()}`,
    ];

    const result = lines.join('\n');
    await callback?.({ text: result } as Parameters<HandlerCallback>[0]);

    return {
      success: true,
      text: result,
      data: { rsi },
    };
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: "What's the RSI for SOL?" } },
      { name: 'lpcli', content: { text: 'Checking the RSI indicator for SOL.' } },
    ],
  ],
};
