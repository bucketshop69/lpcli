/**
 * @lpcli/core public exports
 */

// Config
export type { LPCLIConfig, FundingToken } from './config.js';
export { loadConfig, SOL_MINT, LAMPORTS_PER_SOL, POSITION_RENT_LAMPORTS, DEFAULT_FEE_RESERVE_SOL, feeReserveLamports } from './config.js';

// Types
export type {
  MeteoraTokenInfo,
  MeteoraPoolRaw,
  DiscoveredPool,
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
  DiscoverConfig,
} from './types.js';

// DLMMServiceOptions lives in dlmm.ts (it references WalletService)
export type { DLMMServiceOptions } from './dlmm.js';

// Errors
export { NetworkError, TransactionError } from './errors.js';

// Scoring (legacy — discover now uses API-native metrics)
export { rankPools } from './scoring.js';

// Client
export { MeteoraClient, DEFAULT_DISCOVER_CONFIG } from './client.js';

// Wallet
export type { TokenBalance, WalletBalances, TransferResult } from './wallet.js';
export { WalletService } from './wallet.js';

// EVM Wallet
export type { EvmSignResult, EvmSendResult } from './evm-wallet.js';
export { EvmWalletService } from './evm-wallet.js';

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

// pacific — signing
export type { pacificSignatureHeader, pacificRequestEnvelope } from './pacific.js';
export { preparepacificMessage, signpacificRequest } from './pacific.js';

// pacific — REST client
export type {
  pacificMarketInfo,
  pacificPriceInfo,
  pacificAccountInfo,
  pacificPosition,
  pacificOrder,
  pacificKline,
  pacificKlineInterval,
} from './pacific-client.js';
export { pacificClient, pacificApiError, pacific_REST_URL, pacific_KLINE_INTERVALS } from './pacific-client.js';

// pacific — deposit (on-chain instruction, unsigned)
export {
  createDepositInstruction,
  buildDepositTransaction,
  pacific_PROGRAM_ID,
  pacific_VAULT_PDA,
  pacific_VAULT_USDC_ATA,
  pacific_EVENT_AUTHORITY,
  pacific_USDC_MINT,
  pacific_MIN_DEPOSIT_USDC,
} from './pacific-deposit.js';

// pacific — withdraw (signed REST request)
export { requestWithdrawal } from './pacific-withdraw.js';

// pacific — trade execution (signed REST requests)
export type { MarketOrderParams, LimitOrderParams, MarketOrderResult } from './pacific-trade.js';
export {
  createMarketOrder,
  createLimitOrder,
  cancelOrder,
  cancelStopOrder,
  cancelAllOrders,
  closePosition,
  roundToLotSize,
  validateOrder,
} from './pacific-trade.js';

// pacific — indicators (read-only)
export type { RSIResult } from './pacific-indicators.js';
export { calculateRSI, fetchRSI } from './pacific-indicators.js';

// pacific — TP/SL (signed REST requests)
export type { TPSLParams } from './pacific-tpsl.js';
export { setPositionTPSL } from './pacific-tpsl.js';

// Polymarket — auth (VPS relay)
export type { PolymarketAuthResult, PolymarketRelayConfig } from './polymarket-auth.js';
export { polymarketAuth, getDeriveMessage } from './polymarket-auth.js';

// Polymarket — deposit addresses (Bridge API)
export type { PolymarketDepositAddresses } from './polymarket-deposit.js';
export { getDepositAddresses, getDepositAddressesDirect } from './polymarket-deposit.js';

// Polymarket — allowance & approval
export type { AllowanceStatus, PolymarketAllowances, ApprovalResult } from './polymarket-approve.js';
export { checkAllowances, approveViaRelay, POLYMARKET_SPENDERS } from './polymarket-approve.js';

// Polymarket — order placement
export type { PolymarketOrderParams, PolymarketOrderResult, PolymarketCancelResult } from './polymarket-order.js';
export { placeOrder, getOpenOrders, cancelOrder as cancelPolymarketOrder, cancelAllOrders as cancelAllPolymarketOrders } from './polymarket-order.js';

// Polymarket — positions & balance
export type { PolymarketBalance, PolymarketPosition } from './polymarket-positions.js';
export { getBalance as getPolymarketBalance, getPositions } from './polymarket-positions.js';

// LPCLI
export { LPCLI } from './lpcli.js';
