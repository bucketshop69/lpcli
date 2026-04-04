// ============================================================================
// Wallet Service — @lpcli/core
// ============================================================================

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import type { WalletOptions } from './types.js';

// Internal signer interface — allows OWS or keypair backends behind the same surface
export interface WalletBackend {
  publicKey: PublicKey;
  signTransaction(tx: Transaction): Promise<Transaction>;
}

// OWS backend — wraps @open-wallet-standard/core when installed
export class OWSBackend implements WalletBackend {
  publicKey: PublicKey;
  private walletName: string;

  constructor(walletName: string, publicKey: PublicKey) {
    this.walletName = walletName;
    this.publicKey = publicKey;
  }

  async signTransaction(tx: Transaction): Promise<Transaction> {
    // Use a runtime-only import so TypeScript does not attempt to resolve the
    // optional peer dependency at compile time.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const dynamicImport = new Function('specifier', 'return import(specifier)');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ows = await dynamicImport('@open-wallet-standard/core') as any;
    const txHex = tx.serialize({ requireAllSignatures: false }).toString('hex');
    const signedHex: string = await ows.signTransaction(this.walletName, 'solana', txHex);
    const signedBuf = Buffer.from(signedHex, 'hex');
    return Transaction.from(signedBuf);
  }
}

// Keypair backend — raw Solana Keypair (file or base58)
export class KeypairBackend implements WalletBackend {
  publicKey: PublicKey;
  private keypair: Keypair;

  constructor(keypair: Keypair) {
    this.keypair = keypair;
    this.publicKey = keypair.publicKey;
  }

  async signTransaction(tx: Transaction): Promise<Transaction> {
    tx.partialSign(this.keypair);
    return tx;
  }
}

/**
 * Load a keypair from a JSON file (array of numbers — standard Solana format).
 * Expands leading ~ to the home directory.
 */
export function loadKeypairFromFile(filePath: string): Keypair {
  const resolved = filePath.startsWith('~')
    ? filePath.replace('~', homedir())
    : filePath;
  const json = JSON.parse(readFileSync(resolved, 'utf-8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(json));
}

/**
 * Decode a base58-encoded Solana private key string into a Keypair.
 *
 * Solana's "private key" in base58 is the full 64-byte secret key
 * (32-byte seed + 32-byte public key). We use a minimal base58 decoder
 * so we avoid a hard dependency on the bs58 package at runtime.
 */
export function keypairFromBase58(encoded: string): Keypair {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const alphabetMap: Record<string, number> = {};
  for (let i = 0; i < ALPHABET.length; i++) alphabetMap[ALPHABET[i]] = i;

  let decoded = BigInt(0);
  for (const char of encoded) {
    const digit = alphabetMap[char];
    if (digit === undefined) throw new Error(`Invalid base58 character: ${char}`);
    decoded = decoded * BigInt(58) + BigInt(digit);
  }

  // Convert BigInt to a fixed 64-byte array
  const bytes = new Uint8Array(64);
  let remaining = decoded;
  for (let i = 63; i >= 0; i--) {
    bytes[i] = Number(remaining & BigInt(0xff));
    remaining >>= BigInt(8);
  }

  return Keypair.fromSecretKey(bytes);
}

export class WalletService {
  private backend: WalletBackend;
  private connection: Connection;

  private constructor(backend: WalletBackend, connection: Connection) {
    this.backend = backend;
    this.connection = connection;
  }

  /**
   * Initialise WalletService using the best available backend.
   *
   * Detection order:
   *  1. OWS — if OWS_WALLET_NAME env var is set and @open-wallet-standard/core is installed
   *  2. Keypair file — if PRIVATE_KEY starts with ~ or /
   *  3. Keypair base58 — if PRIVATE_KEY is a base58 string
   *  4. Error — nothing configured
   *
   * The options.privateKey param (from LPCLIOptions) is used as a fallback
   * when PRIVATE_KEY is not set in the environment.
   */
  static async init(options: WalletOptions): Promise<WalletService> {
    const connection = new Connection(options.rpcUrl, 'confirmed');

    // ── 1. OWS backend ──────────────────────────────────────────────────────
    const owsWalletName = options.owsWalletName ?? process.env['OWS_WALLET_NAME'];
    if (owsWalletName) {
      try {
        // Runtime-only import to avoid compile-time resolution of optional peer dep.
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const dynamicImport = new Function('specifier', 'return import(specifier)');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ows = await dynamicImport('@open-wallet-standard/core') as any;
        const wallets: unknown[] = await ows.listWallets();
        const wallet = wallets.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (w: any) => w.name === owsWalletName
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ) as any;
        if (!wallet) {
          throw new Error(`OWS wallet "${owsWalletName}" not found. Run: ows wallet create --name ${owsWalletName}`);
        }
        // OWS wallet has accounts[] per chain — find the Solana one
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const solanaAccount = (wallet.accounts as any[]).find(
          (a: any) => typeof a.chainId === 'string' && a.chainId.startsWith('solana:')
        );
        if (!solanaAccount) {
          throw new Error(`OWS wallet "${owsWalletName}" has no Solana account.`);
        }
        const pubkey = new PublicKey(solanaAccount.address as string);
        const backend = new OWSBackend(owsWalletName, pubkey);
        return new WalletService(backend, connection);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        // If OWS is simply not installed, fall through to keypair backends
        if (message.includes('Cannot find') || message.includes('ERR_MODULE_NOT_FOUND') || message.includes('MODULE_NOT_FOUND')) {
          // OWS package not installed — silently fall through
        } else {
          // OWS is installed but configuration failed — propagate
          throw err;
        }
      }
    }

    // ── 2 & 3. Keypair backends ──────────────────────────────────────────────
    const privateKeyEnv = process.env['PRIVATE_KEY'] ?? options.privateKey;
    if (privateKeyEnv) {
      if (privateKeyEnv.startsWith('~') || privateKeyEnv.startsWith('/')) {
        // File path backend
        const keypair = loadKeypairFromFile(privateKeyEnv);
        return new WalletService(new KeypairBackend(keypair), connection);
      } else {
        // base58 string backend
        const keypair = keypairFromBase58(privateKeyEnv);
        return new WalletService(new KeypairBackend(keypair), connection);
      }
    }

    // ── 4. Nothing configured ────────────────────────────────────────────────
    throw new Error(
      'No wallet configured. Run `lpcli init` to set up.'
    );
  }

  /** Return the wallet's Solana public key. */
  getPublicKey(): PublicKey {
    return this.backend.publicKey;
  }

  /** Return the SOL balance in lamports via RPC. */
  async getBalance(): Promise<number> {
    return this.connection.getBalance(this.backend.publicKey);
  }

  /**
   * Sign a transaction using whichever backend is active.
   * Does NOT broadcast — the caller is responsible for sending.
   */
  async signTx(tx: Transaction): Promise<Transaction> {
    return this.backend.signTransaction(tx);
  }

  /**
   * Estimate the priority fee for a transaction via Helius.
   * Falls back to 0 on any failure (network, auth, parse, etc.).
   *
   * @param txBase64 - base64-encoded serialised transaction
   * @param level - Helius priority level (default: "Medium")
   */
  async getPriorityFee(
    txBase64: string,
    level: 'Min' | 'Low' | 'Medium' | 'High' | 'VeryHigh' | 'UnsafeMax' = 'Medium'
  ): Promise<number> {
    try {
      const response = await fetch(this.connection.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getPriorityFeeEstimate',
          params: [
            {
              transaction: txBase64,
              options: { priorityLevel: level },
            },
          ],
        }),
      });

      if (!response.ok) return 0;

      const json = (await response.json()) as {
        result?: { priorityFeeEstimate?: number };
        error?: unknown;
      };

      if (json.error || json.result?.priorityFeeEstimate === undefined) return 0;
      return json.result.priorityFeeEstimate;
    } catch {
      return 0;
    }
  }
}
