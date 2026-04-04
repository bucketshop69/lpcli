/**
 * @lpcli/core public exports
 */

// Types
export type {
  MeteoraPoolRaw,
  ScoredPool,
  Position,
  PoolInfo,
  OpenPositionResult,
  ClosePositionResult,
  MeteoraClientOptions,
  WalletOptions,
  LPCLIOptions,
  ScoringWeights,
} from './types.js';

// DLMMServiceOptions lives in dlmm.ts (it references WalletService)
export type { DLMMServiceOptions } from './dlmm.js';

// Errors
export { NetworkError, TransactionError } from './errors.js';

// Scoring
export { rankPools } from './scoring.js';

// Client
export { MeteoraClient } from './client.js';

// Wallet
export { WalletService } from './wallet.js';

// DLMM
export { DLMMService } from './dlmm.js';

// Jupiter
export type { JupiterSwapParams, JupiterSwapResult, JupiterQuoteResult, UltraOrderResponse } from './jup.js';
export { jupiterSwap, getJupiterQuote, getUltraOrder, SOL_MINT, USDC_MINT } from './jup.js';

// LPCLI
export { LPCLI } from './lpcli.js';
