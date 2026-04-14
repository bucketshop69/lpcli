/**
 * @lpcli/eliza — ElizaOS plugin for lpcli DeFi operations.
 *
 * Same @lpcli/core engine that powers CLI, MCP, and x402 — now conversational.
 * Actions cover perpetuals trading, LP management, and technical analysis.
 */

import type { Plugin } from '@elizaos/core';
import { initService } from './services/lpcli.service.js';

// Actions
import { perpsMarketsAction } from './actions/perps-markets.js';
import { perpsAccountAction } from './actions/perps-account.js';
import { perpsPositionsAction } from './actions/perps-positions.js';
import { perpsTradeAction } from './actions/perps-trade.js';
import { perpsCloseAction } from './actions/perps-close.js';
import { perpsStopLossAction } from './actions/perps-sl.js';
import { perpsTakeProfitAction } from './actions/perps-tp.js';
import { discoverPoolsAction } from './actions/discover-pools.js';
import { lpPositionsAction } from './actions/lp-positions.js';
import { lpOpenAction } from './actions/lp-open.js';
import { lpCloseAction } from './actions/lp-close.js';
import { lpClaimAction } from './actions/lp-claim.js';
import { checkRsiAction } from './actions/check-rsi.js';
import { perpsCancelAction } from './actions/perps-cancel.js';
import { perpsDepositAction } from './actions/perps-deposit.js';
import { perpsWithdrawAction } from './actions/perps-withdraw.js';
import { swapTokensAction } from './actions/swap-tokens.js';

// Providers
import { portfolioProvider } from './providers/portfolio.provider.js';
import { marketProvider } from './providers/market.provider.js';

export const lpcliPlugin: Plugin = {
  name: '@lpcli/eliza',
  description: 'DeFi portfolio manager — perpetuals trading, LP management, and technical analysis on Solana.',

  init: async (_config, runtime) => {
    initService(runtime);
  },

  actions: [
    // Read-only
    perpsMarketsAction,
    perpsAccountAction,
    perpsPositionsAction,
    discoverPoolsAction,
    lpPositionsAction,
    lpOpenAction,
    lpCloseAction,
    lpClaimAction,
    checkRsiAction,
    // Write (signing)
    perpsTradeAction,
    perpsCloseAction,
    perpsStopLossAction,
    perpsTakeProfitAction,
    perpsCancelAction,
    perpsDepositAction,
    perpsWithdrawAction,
    swapTokensAction,
  ],

  providers: [
    portfolioProvider,
    marketProvider,
  ],

  evaluators: [],
};

export default lpcliPlugin;
