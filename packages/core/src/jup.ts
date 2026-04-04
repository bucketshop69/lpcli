// ============================================================================
// Jupiter Ultra API — swap service for @lpcli/core
// ============================================================================

import { VersionedTransaction } from '@solana/web3.js';
import { NetworkError, TransactionError } from './errors.js';
import type { WalletService } from './wallet.js';

// ============================================================================
// Types
// ============================================================================

export interface JupiterSwapParams {
  inputMint: string;
  outputMint: string;
  /** Amount in smallest unit (lamports for SOL, etc.) */
  amount: string | number;
  slippageBps?: number;
  referralAccount?: string;
  referralFeeBps?: number;
}

export interface JupiterSwapResult {
  signature: string;
  requestId: string;
  swapType: 'ultra-aggregator' | 'ultra-rfq';
  inputAmountResult?: string;
  outputAmountResult?: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
}

export interface JupiterQuoteResult {
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  slippageBps: number;
}

// ============================================================================
// Ultra API response types
// ============================================================================

export interface UltraOrderResponse {
  mode: 'ultra';
  swapType: 'aggregator' | 'rfq';
  router: string;
  requestId: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: 'ExactIn' | 'ExactOut';
  slippageBps: number;
  priceImpactPct: string;
  inputMint: string;
  outputMint: string;
  taker: string;
  transaction: string; // Base64 encoded
  prioritizationFeeLamports: number;
  inUsdValue?: number;
  outUsdValue?: number;
}

interface UltraExecuteResponse {
  status: 'Success' | 'Failed';
  signature: string;
  code: number;
  inputAmountResult?: string;
  outputAmountResult?: string;
  error?: string;
}

// ============================================================================
// Constants
// ============================================================================

const ULTRA_API_BASE = 'https://lite-api.jup.ag/ultra/v1';

// Well-known mints
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// ============================================================================
// Retry helper
// ============================================================================

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 2000,
  label = 'operation'
): Promise<T> {
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxAttempts) throw lastErr;
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), 10_000);
      console.warn(`${label} attempt ${attempt} failed: ${lastErr.message}. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr!;
}

// ============================================================================
// API functions
// ============================================================================

/**
 * Get a swap order from Jupiter Ultra API.
 */
export async function getUltraOrder(params: {
  inputMint: string;
  outputMint: string;
  amount: string | number;
  taker: string;
  referralAccount?: string;
  referralFeeBps?: number;
}): Promise<UltraOrderResponse> {
  return withRetry(async () => {
    const qs = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: String(params.amount),
      taker: params.taker,
    });
    if (params.referralAccount) qs.set('referralAccount', params.referralAccount);
    if (params.referralFeeBps !== undefined) qs.set('referralFee', String(params.referralFeeBps));

    const res = await fetch(`${ULTRA_API_BASE}/order?${qs}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new NetworkError(`Jupiter Ultra order API: ${res.status} ${res.statusText} — ${body}`);
    }
    const data = (await res.json()) as UltraOrderResponse;
    if (!data.transaction) {
      throw new TransactionError('Jupiter Ultra API returned no transaction', 'NO_TRANSACTION');
    }
    return data;
  }, 3, 2000, 'Jupiter Ultra order');
}

/**
 * Get a price quote without executing (uses a dummy taker).
 */
export async function getJupiterQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: string | number;
}): Promise<JupiterQuoteResult> {
  const DUMMY_TAKER = '11111111111111111111111111111111';
  const order = await getUltraOrder({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    taker: DUMMY_TAKER,
  });
  return {
    inAmount: order.inAmount,
    outAmount: order.outAmount,
    priceImpactPct: order.priceImpactPct,
    slippageBps: order.slippageBps,
  };
}

/**
 * Execute a complete swap: get order → sign → execute.
 *
 * Requires a keypair-backed WalletService (not OWS) because Jupiter Ultra API
 * returns VersionedTransaction which needs direct Keypair signing.
 */
export async function jupiterSwap(
  params: JupiterSwapParams,
  wallet: WalletService,
): Promise<JupiterSwapResult> {
  const keypair = wallet.getKeypair();
  const taker = keypair.publicKey.toBase58();

  // Step 1: Get order
  const order = await getUltraOrder({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    taker,
    referralAccount: params.referralAccount,
    referralFeeBps: params.referralFeeBps,
  });

  // Step 2: Deserialize and sign
  const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, 'base64'));
  tx.sign([keypair]);
  const signedTx = Buffer.from(tx.serialize()).toString('base64');

  // Step 3: Execute via Ultra API
  const result = await withRetry(async () => {
    const res = await fetch(`${ULTRA_API_BASE}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedTransaction: signedTx, requestId: order.requestId }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new NetworkError(`Jupiter Ultra execute API: ${res.status} — ${body}`);
    }
    const data = (await res.json()) as UltraExecuteResponse;
    if (data.status === 'Failed') {
      throw new TransactionError(
        `Jupiter swap failed: ${data.error ?? 'unknown'} (code ${data.code})`,
        'JUPITER_SWAP_FAILED',
      );
    }
    return data;
  }, 3, 2000, 'Jupiter Ultra execute');

  return {
    signature: result.signature,
    requestId: order.requestId,
    swapType: order.swapType === 'aggregator' ? 'ultra-aggregator' : 'ultra-rfq',
    inputAmountResult: result.inputAmountResult,
    outputAmountResult: result.outputAmountResult,
    inAmount: order.inAmount,
    outAmount: order.outAmount,
    priceImpactPct: order.priceImpactPct,
  };
}
