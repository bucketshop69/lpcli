// ============================================================================
// MagicBlock Private Payments Client — @lpcli/core
//
// Thin wrapper around the MagicBlock Private Payments REST API.
// Builds unsigned transactions for private SPL transfers via
// Private Ephemeral Rollups (PERs).
//
// API docs: https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/api-reference
// ============================================================================

import { Transaction, VersionedTransaction } from '@solana/web3.js';
import type { WalletService } from './wallet.js';
import { USDC_MINT } from './jup.js';

// ============================================================================
// Constants
// ============================================================================

export const MAGICBLOCK_API_URL = 'https://payments.magicblock.app';

// ============================================================================
// Types
// ============================================================================

export interface PrivateTransferParams {
  /** Sender address (defaults to wallet's address if omitted). */
  from?: string;
  /** Recipient address. */
  to: string;
  /** Amount in UI units (e.g. 50 = 50 USDC). */
  amount: number;
  /** SPL token mint. Defaults to USDC. */
  mint?: string;
  /** Token decimals for UI→base conversion. Defaults to 6 for USDC, required for other tokens. */
  decimals?: number;
  /** "public" or "private". Defaults to "private". */
  visibility?: 'public' | 'private';
  /** Source balance location. Defaults to "base" (Solana mainnet). */
  fromBalance?: 'base' | 'ephemeral';
  /** Destination balance location. Defaults to "base" (Solana mainnet). */
  toBalance?: 'base' | 'ephemeral';
  /** Split transfer into N pieces (1-15) for extra obfuscation. */
  split?: number;
  /** Minimum delay before delivery (ms). */
  minDelayMs?: string;
  /** Maximum delay before delivery (ms). */
  maxDelayMs?: string;
  /** Encrypted memo. */
  memo?: string;
  /** Solana cluster. */
  cluster?: string;
  /** Initialize missing private accounts. */
  initIfMissing?: boolean;
  /** Initialize missing ATAs. */
  initAtasIfMissing?: boolean;
  /** Initialize missing vaults. */
  initVaultIfMissing?: boolean;
}

export interface UnsignedTransactionResponse {
  kind: string;
  transactionBase64: string;
  sendTo: 'base' | 'ephemeral';
  recentBlockhash: string;
  lastValidBlockHeight: number;
  instructionCount: number;
  requiredSigners: string[];
  validator?: string;
}

export interface PrivateTransferResult {
  txSignature: string;
  from: string;
  to: string;
  amount: number;
  visibility: 'public' | 'private';
  unsignedTx: UnsignedTransactionResponse;
}

export interface MagicBlockBalance {
  amount: number;
  mint: string;
}

// ============================================================================
// Client
// ============================================================================

export class MagicBlockClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? MAGICBLOCK_API_URL;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Health
  // ────────────────────────────────────────────────────────────────────────

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Build unsigned transfer
  // ────────────────────────────────────────────────────────────────────────

  async buildTransfer(params: {
    from: string;
    to: string;
    amount: number;
    mint?: string;
    visibility?: 'public' | 'private';
    fromBalance?: 'base' | 'ephemeral';
    toBalance?: 'base' | 'ephemeral';
    split?: number;
    minDelayMs?: string;
    maxDelayMs?: string;
    memo?: string;
    cluster?: string;
    initIfMissing?: boolean;
    initAtasIfMissing?: boolean;
    initVaultIfMissing?: boolean;
  }): Promise<UnsignedTransactionResponse> {
    const body: Record<string, unknown> = {
      owner: params.from,
      from: params.from,
      to: params.to,
      amount: params.amount,
      mint: params.mint ?? USDC_MINT,
      visibility: params.visibility ?? 'private',
      fromBalance: params.fromBalance ?? 'base',
      toBalance: params.toBalance ?? 'base',
      initIfMissing: params.initIfMissing ?? true,
      initAtasIfMissing: params.initAtasIfMissing ?? true,
    };

    if (params.split !== undefined) body.split = params.split;
    if (params.minDelayMs !== undefined) body.minDelayMs = params.minDelayMs;
    if (params.maxDelayMs !== undefined) body.maxDelayMs = params.maxDelayMs;
    if (params.memo !== undefined) body.memo = params.memo;
    if (params.cluster !== undefined) body.cluster = params.cluster;
    if (params.initVaultIfMissing !== undefined) body.initVaultIfMissing = params.initVaultIfMissing;

    const res = await fetch(`${this.baseUrl}/v1/spl/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } })) as { error?: { message?: string } };
      const msg = err?.error?.message ?? `${res.status} ${res.statusText}`;
      throw new Error(`MagicBlock API error: ${msg}`);
    }

    return res.json() as Promise<UnsignedTransactionResponse>;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Build unsigned deposit
  // ────────────────────────────────────────────────────────────────────────

  async buildDeposit(params: {
    owner: string;
    amount: number;
    mint?: string;
    cluster?: string;
    initIfMissing?: boolean;
    initVaultIfMissing?: boolean;
  }): Promise<UnsignedTransactionResponse> {
    const body: Record<string, unknown> = {
      owner: params.owner,
      amount: params.amount,
      mint: params.mint ?? USDC_MINT,
      initIfMissing: params.initIfMissing ?? true,
    };

    if (params.cluster !== undefined) body.cluster = params.cluster;
    if (params.initVaultIfMissing !== undefined) body.initVaultIfMissing = params.initVaultIfMissing;

    const res = await fetch(`${this.baseUrl}/v1/spl/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } })) as { error?: { message?: string } };
      const msg = err?.error?.message ?? `${res.status} ${res.statusText}`;
      throw new Error(`MagicBlock deposit error: ${msg}`);
    }

    return res.json() as Promise<UnsignedTransactionResponse>;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Build unsigned withdrawal
  // ────────────────────────────────────────────────────────────────────────

  async buildWithdraw(params: {
    owner: string;
    amount: number;
    mint?: string;
    cluster?: string;
  }): Promise<UnsignedTransactionResponse> {
    const body: Record<string, unknown> = {
      owner: params.owner,
      amount: params.amount,
      mint: params.mint ?? USDC_MINT,
    };

    if (params.cluster !== undefined) body.cluster = params.cluster;

    const res = await fetch(`${this.baseUrl}/v1/spl/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } })) as { error?: { message?: string } };
      const msg = err?.error?.message ?? `${res.status} ${res.statusText}`;
      throw new Error(`MagicBlock withdraw error: ${msg}`);
    }

    return res.json() as Promise<UnsignedTransactionResponse>;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Balance queries
  // ────────────────────────────────────────────────────────────────────────

  async getBalance(owner: string, mint?: string): Promise<MagicBlockBalance> {
    const params = new URLSearchParams({ owner });
    if (mint) params.set('mint', mint);

    const res = await fetch(`${this.baseUrl}/v1/spl/balance?${params}`);
    if (!res.ok) {
      throw new Error(`MagicBlock balance error: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<MagicBlockBalance>;
  }

  async getPrivateBalance(owner: string, mint?: string): Promise<MagicBlockBalance> {
    const params = new URLSearchParams({ owner });
    if (mint) params.set('mint', mint);

    const res = await fetch(`${this.baseUrl}/v1/spl/private-balance?${params}`);
    if (!res.ok) {
      throw new Error(`MagicBlock private balance error: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<MagicBlockBalance>;
  }
}

// ============================================================================
// Sign & send helper
// ============================================================================

/**
 * Sign an unsigned transaction from MagicBlock and broadcast it.
 *
 * MagicBlock returns base64-encoded unsigned transactions.
 * We deserialize, sign via OWS, and send to Solana.
 */
export async function signAndSendMagicBlockTx(
  wallet: WalletService,
  unsignedTx: UnsignedTransactionResponse,
): Promise<string> {
  if (unsignedTx.sendTo === 'ephemeral') {
    const endpoint = unsignedTx.validator;
    if (!endpoint) {
      throw new Error('MagicBlock returned sendTo: "ephemeral" but no validator URL');
    }
    const { Connection: EphConnection } = await import('@solana/web3.js');
    const ephConn = new EphConnection(endpoint, 'confirmed');
    return signAndSendToConnection(wallet, unsignedTx, ephConn);
  }

  return signAndSendToConnection(wallet, unsignedTx, wallet.getConnection());
}

async function signAndSendToConnection(
  wallet: WalletService,
  unsignedTx: UnsignedTransactionResponse,
  connection: import('@solana/web3.js').Connection,
): Promise<string> {
  const txBytes = Buffer.from(unsignedTx.transactionBase64, 'base64');

  // Detect format: versioned transactions start with a version prefix byte
  let isVersioned = false;
  try {
    VersionedTransaction.deserialize(txBytes);
    isVersioned = true;
  } catch {
    // Not a versioned transaction — use legacy
  }

  let signature: string;
  if (isVersioned) {
    const vtx = VersionedTransaction.deserialize(txBytes);
    const signed = await wallet.signVersionedTx(vtx);
    signature = await connection.sendRawTransaction(signed.serialize());
  } else {
    const tx = Transaction.from(txBytes);
    const signed = await wallet.signTx(tx);
    signature = await connection.sendRawTransaction(signed.serialize());
  }

  await connection.confirmTransaction(signature, 'confirmed');
  return signature;
}

// ============================================================================
// High-level: private transfer (single call)
// ============================================================================

/**
 * Execute a private (or public) SPL transfer via MagicBlock PERs.
 *
 * This is the main entry point — builds the tx, signs it, sends it.
 * For USDC on mainnet, just pass `to`, `amount`, and `visibility`.
 */
export async function executePrivateTransfer(
  wallet: WalletService,
  params: PrivateTransferParams,
  client?: MagicBlockClient,
): Promise<PrivateTransferResult> {
  const c = client ?? new MagicBlockClient();
  const from = params.from ?? wallet.getPublicKey().toBase58();
  const mint = params.mint ?? USDC_MINT;
  const visibility = params.visibility ?? 'private';

  // Convert UI amount to base units
  const decimals = params.decimals ?? (mint === USDC_MINT ? 6 : undefined);
  if (decimals === undefined) {
    throw new Error(
      `executePrivateTransfer: decimals required for non-USDC token ${mint.slice(0, 8)}...\n` +
      `Pass { decimals } in params or use USDC (auto-detected as 6).`
    );
  }
  const baseAmount = Math.floor(params.amount * 10 ** decimals);

  const unsignedTx = await c.buildTransfer({
    from,
    to: params.to,
    amount: baseAmount,
    mint,
    visibility,
    fromBalance: params.fromBalance ?? 'base',
    toBalance: params.toBalance ?? 'base',
    split: params.split,
    minDelayMs: params.minDelayMs,
    maxDelayMs: params.maxDelayMs,
    memo: params.memo,
    cluster: params.cluster,
    initIfMissing: params.initIfMissing ?? true,
    initAtasIfMissing: params.initAtasIfMissing ?? true,
    initVaultIfMissing: params.initVaultIfMissing,
  });

  const txSignature = await signAndSendMagicBlockTx(wallet, unsignedTx);

  return {
    txSignature,
    from,
    to: params.to,
    amount: params.amount,
    visibility,
    unsignedTx,
  };
}
