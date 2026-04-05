/**
 * @lpcli/core public exports
 */

// Config
export type { LPCLIConfig, FundingToken } from './config.js';
export { loadConfig, SOL_MINT, LAMPORTS_PER_SOL, POSITION_RENT_LAMPORTS, feeReserveLamports } from './config.js';

// Types
export type {
  MeteoraPoolRaw,
  ScoredPool,
  Position,
  PoolInfo,
  PoolMeta,
  SwapStep,
  OpenPositionResult,
  ClosePositionResult,
  FundedOpenResult,
  FundedCloseResult,
  FundedClaimResult,
  MeteoraClientOptions,
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
export type { TokenBalance, WalletBalances, TransferResult } from './wallet.js';
export { WalletService } from './wallet.js';

// DLMM
export { DLMMService } from './dlmm.js';

// Jupiter
export type { JupiterSwapParams, JupiterSwapResult, JupiterQuoteResult, UltraOrderResponse } from './jup.js';
export { jupiterSwap, getJupiterQuote, getUltraOrder, USDC_MINT } from './jup.js';

// Funding operations
export { fundedOpen, fundedClose, fundedClaim, calculateSplit, planSwaps, planSwapBack, executeSwaps } from './funding.js';
export type { LiquiditySplit } from './funding.js';

// LPCLI
export { LPCLI } from './lpcli.js';
