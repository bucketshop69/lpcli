// ============================================================================
// pacific Deposit — @lpcli/core
//
// Builds the deposit instruction for the pacific on-chain program.
// DOES NOT sign or send — the caller is responsible for that.
// ============================================================================

import {
  PublicKey,
  TransactionInstruction,
  Transaction,
  SystemProgram,
} from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

// ============================================================================
// Protocol constants
// ============================================================================

export const pacific_PROGRAM_ID = new PublicKey('PCFA5iYgmqK6MqPhWNKg7Yv7auX7VZ4Cx7T1eJyrAMH');
export const pacific_VAULT_PDA = new PublicKey('9Gdmhq4Gv1LnNMp7aiS1HSVd7pNnXNMsbuXALCQRmGjY');
export const pacific_VAULT_USDC_ATA = new PublicKey('72R843XwZxqWhsJceARQQTTbYtWy6Zw9et2YV4FpRHTa');
/** Anchor __event_authority PDA — used for CPI event emission. */
export const pacific_EVENT_AUTHORITY = new PublicKey('2cPFdP7ADcdQE2rG9BqASYAVosZv3PX5yCyTdYCfGq8V');

/** Minimum deposit accepted by pacific backend (below this, deposit is ignored). */
export const pacific_MIN_DEPOSIT_USDC = 10;
export const pacific_USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

const DEPOSIT_DISCRIMINATOR = Buffer.from('f223c68952e1f2b6', 'hex');

// ============================================================================
// Instruction builder
// ============================================================================

/**
 * Build the deposit TransactionInstruction for pacific.
 *
 * @param userWallet - The depositor's public key (will be signer).
 * @param amountUsdc - Amount in human units (e.g. 100.0 = $100).
 */
export function createDepositInstruction(
  userWallet: PublicKey,
  amountUsdc: number,
): TransactionInstruction {
  const userUsdcAta = getAssociatedTokenAddressSync(pacific_USDC_MINT, userWallet);

  // Instruction data: 8-byte discriminator + 8-byte u64 amount in smallest units
  const amountRaw = BigInt(Math.round(amountUsdc * 1e6));
  const data = Buffer.alloc(16);
  DEPOSIT_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(amountRaw, 8);

  const keys = [
    { pubkey: userWallet, isSigner: true, isWritable: true },
    { pubkey: userUsdcAta, isSigner: false, isWritable: true },
    { pubkey: pacific_VAULT_PDA, isSigner: false, isWritable: true },
    { pubkey: pacific_VAULT_USDC_ATA, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: pacific_USDC_MINT, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: pacific_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: pacific_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId: pacific_PROGRAM_ID,
    keys,
    data,
  });
}

// ============================================================================
// Transaction builder
// ============================================================================

/**
 * Build an unsigned deposit transaction.
 * The caller is responsible for signing and sending.
 *
 * @param userWallet - The depositor's public key.
 * @param amountUsdc - Amount in human units (e.g. 100.0 = $100).
 * @param connection - Solana RPC connection (used to fetch recent blockhash).
 */
export async function buildDepositTransaction(
  userWallet: PublicKey,
  amountUsdc: number,
  connection: Connection,
): Promise<Transaction> {
  const ix = createDepositInstruction(userWallet, amountUsdc);
  const tx = new Transaction().add(ix);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = userWallet;
  return tx;
}
