/**
 * @lpcli/core public exports
 */

// Config
export type { LPCLIConfig, FundingToken } from './config.js';
export { loadConfig, SOL_MINT, LAMPORTS_PER_SOL, POSITION_RENT_LAMPORTS, DEFAULT_FEE_RESERVE_SOL, feeReserveLamports } from './config.js';

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
  ReadinessStatus,
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
export type { JupiterSwapParams, JupiterSwapResult, UltraOrderResponse } from './jup.js';
export { jupiterSwap, getUltraOrder, USDC_MINT } from './jup.js';

// Funding operations
export { fundedOpen, fundedClose, fundedClaim, calculateSplit, planSwaps, planSwapBack, executeSwaps } from './funding.js';
export type { LiquiditySplit } from './funding.js';

// Token Registry
export type { TokenInfo } from './tokens.js';
export { TokenRegistry } from './tokens.js';

// Pacifica — signing
export type { PacificaSignatureHeader, PacificaRequestEnvelope } from './pacifica.js';
export { preparePacificaMessage, signPacificaRequest } from './pacifica.js';

// Pacifica — REST client
export type {
  PacificaMarketInfo,
  PacificaPriceInfo,
  PacificaAccountInfo,
  PacificaPosition,
  PacificaOrder,
} from './pacifica-client.js';
export { PacificaClient, PacificaApiError, PACIFICA_REST_URL } from './pacifica-client.js';

// Pacifica — deposit (on-chain instruction, unsigned)
export {
  createDepositInstruction,
  buildDepositTransaction,
  PACIFICA_PROGRAM_ID,
  PACIFICA_VAULT_PDA,
  PACIFICA_VAULT_USDC_ATA,
  PACIFICA_EVENT_AUTHORITY,
  PACIFICA_USDC_MINT,
  PACIFICA_MIN_DEPOSIT_USDC,
} from './pacifica-deposit.js';

// Pacifica — withdraw (signed REST request)
export { requestWithdrawal } from './pacifica-withdraw.js';

// Pacifica — trade execution (signed REST requests)
export type { MarketOrderParams, MarketOrderResult } from './pacifica-trade.js';
export {
  createMarketOrder,
  cancelOrder,
  cancelAllOrders,
  closePosition,
  roundToLotSize,
  validateOrder,
} from './pacifica-trade.js';

// Pacifica — TP/SL (signed REST requests)
export type { TPSLParams } from './pacifica-tpsl.js';
export { setPositionTPSL } from './pacifica-tpsl.js';

// LPCLI
export { LPCLI } from './lpcli.js';
