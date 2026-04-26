// ============================================================================
// Burner Wallet — @lpcli/core
//
// Auto-managed burner wallet for private operations.
// Created silently on first private action via OWS SDK.
// No user-facing commands — purely transparent.
// ============================================================================

import { WalletService } from './wallet.js';
import { executePrivateTransfer } from './magicblock.js';
import type { PrivateTransferResult } from './magicblock.js';

// ============================================================================
// Constants
// ============================================================================

/** OWS wallet name for the burner. */
export const BURNER_WALLET_NAME = 'lpcli-burner';

/**
 * Minimum SOL the burner needs for a position open:
 * - 0.06 SOL position account rent (POSITION_RENT_LAMPORTS)
 * - 0.02 SOL fee reserve (DEFAULT_FEE_RESERVE_SOL)
 * - 0.02 SOL margin for swap tx fees
 */
const MIN_GAS_SOL = 0.1;

// ============================================================================
// OWS SDK — wallet creation
// ============================================================================

interface OWSCreateResult {
  id: string;
  name: string;
  accounts: { chainId: string; address: string }[];
}

async function getOWS(): Promise<{
  getWallet(name: string): OWSCreateResult;
  createWallet(name: string): OWSCreateResult;
}> {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const dynamicImport = new Function('specifier', 'return import(specifier)');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return dynamicImport('@open-wallet-standard/core') as any;
}

// ============================================================================
// Core functions
// ============================================================================

/**
 * Ensure the burner wallet exists. Creates it via OWS if not found.
 * Returns a WalletService instance for the burner.
 */
export async function ensureBurnerWallet(rpcUrl: string): Promise<WalletService> {
  const ows = await getOWS();

  try {
    ows.getWallet(BURNER_WALLET_NAME);
  } catch {
    // Wallet doesn't exist — create it
    ows.createWallet(BURNER_WALLET_NAME);
  }

  return WalletService.init(BURNER_WALLET_NAME, rpcUrl);
}

/**
 * Get the burner wallet address without initializing a full WalletService.
 * Returns null if burner doesn't exist yet.
 */
export function getBurnerAddress(): string | null {
  try {
    // Synchronous check — OWS SDK calls are sync
    // We can't use async here, so we use the dynamic import trick inline
    // For now, return null and let ensureBurnerWallet handle creation
    return null;
  } catch {
    return null;
  }
}

/**
 * Fund the burner wallet via MagicBlock PER (private transfer).
 *
 * Transfers funding token from main wallet to burner through PER.
 * The on-chain link between main and burner is broken.
 *
 * Also sends a small SOL amount for gas fees (public — known limitation).
 */
export async function fundBurner(
  mainWallet: WalletService,
  burnerWallet: WalletService,
  amount: number,
  mint: string,
  decimals: number,
  opts?: { skipGas?: boolean },
): Promise<{ transfer: PrivateTransferResult; gasTx?: string }> {
  const burnerAddress = burnerWallet.getPublicKey().toBase58();

  // 1. Fund gas if needed (small public SOL transfer — known hackathon limitation)
  let gasTx: string | undefined;
  if (!opts?.skipGas) {
    const burnerSolBalance = await burnerWallet.getBalance();
    const lamportsPerSol = 1_000_000_000;
    const solBalance = burnerSolBalance / lamportsPerSol;

    if (solBalance < MIN_GAS_SOL) {
      const gasResult = await mainWallet.transferSOL(burnerAddress, MIN_GAS_SOL);
      gasTx = gasResult.signature;
    }
  }

  // 2. Fund via PER (private)
  const transfer = await executePrivateTransfer(mainWallet, {
    to: burnerAddress,
    amount,
    mint,
    decimals,
    visibility: 'private',
  });

  return { transfer, gasTx };
}
