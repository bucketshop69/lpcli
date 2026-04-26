/**
 * Re-exports from @lpcli/core and @lpcli/monitor.
 *
 * Keeps commands.ts cleaner and gives us one place to adjust imports.
 */

export { LPCLI, PacificaClient, SOL_MINT, MagicBlockClient, executePrivateTransfer, signAndSendMagicBlockTx, ensureBurnerWallet, fundBurner } from '@lpcli/core';
export type { PrivateTransferResult, MagicBlockBalance } from '@lpcli/core';
export type {
  DiscoveredPool,
  FundedOpenResult,
  OpenPositionResult,
  FundingToken,
  PacificaPosition,
  PacificaAccountInfo,
  PacificaMarketInfo,
  PacificaPriceInfo,
} from '@lpcli/core';
export { WatcherStore } from '@lpcli/monitor';
export type { Watcher, Condition, Action } from '@lpcli/monitor';
