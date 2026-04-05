// ============================================================================
// Wallet Service — @lpcli/core
//
// All signing goes through OWS (@open-wallet-standard/core).
// No raw private keys — OWS encrypts at rest, decrypts only for signing.
// ============================================================================

import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

// ============================================================================
// OWS SDK — lazy loaded to avoid hard compile-time dependency
// ============================================================================

interface OWSSdk {
  getWallet(nameOrId: string): { id: string; name: string; accounts: { chainId: string; address: string }[] };
  signTransaction(wallet: string, chain: string, txHex: string): string;
}

let _ows: OWSSdk | null = null;

async function getOWS(): Promise<OWSSdk> {
  if (_ows) return _ows;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const dynamicImport = new Function('specifier', 'return import(specifier)');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await dynamicImport('@open-wallet-standard/core') as any;
  _ows = mod as OWSSdk;
  return _ows;
}

// ============================================================================
// WalletService
// ============================================================================

export class WalletService {
  private walletName: string;
  private _publicKey: PublicKey;
  private connection: Connection;

  private constructor(walletName: string, publicKey: PublicKey, connection: Connection) {
    this.walletName = walletName;
    this._publicKey = publicKey;
    this.connection = connection;
  }

  /**
   * Initialise WalletService from an OWS wallet.
   *
   * @param walletName - OWS wallet name (e.g. "lpcli")
   * @param rpcUrl - Solana RPC URL
   */
  static async init(walletName: string, rpcUrl: string): Promise<WalletService> {
    const connection = new Connection(rpcUrl, 'confirmed');
    const ows = await getOWS();

    let wallet: ReturnType<OWSSdk['getWallet']>;
    try {
      wallet = ows.getWallet(walletName);
    } catch (err: unknown) {
      throw new Error(
        `OWS wallet "${walletName}" not found. Run: ows wallet create --name ${walletName}\n` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const solanaAccount = wallet.accounts.find(
      (a) => a.chainId.startsWith('solana:')
    );
    if (!solanaAccount) {
      throw new Error(`OWS wallet "${walletName}" has no Solana account.`);
    }

    const publicKey = new PublicKey(solanaAccount.address);
    return new WalletService(walletName, publicKey, connection);
  }

  /** Return the wallet's Solana public key. */
  getPublicKey(): PublicKey {
    return this._publicKey;
  }

  /** Return the SOL balance in lamports via RPC. */
  async getBalance(): Promise<number> {
    return this.connection.getBalance(this._publicKey);
  }

  /**
   * Sign a legacy Transaction via OWS.
   * Does NOT broadcast — the caller is responsible for sending.
   */
  async signTx(tx: Transaction): Promise<Transaction> {
    const ows = await getOWS();
    const txHex = tx.serialize({ requireAllSignatures: false }).toString('hex');
    const signedHex = ows.signTransaction(this.walletName, 'solana', txHex);
    return Transaction.from(Buffer.from(signedHex, 'hex'));
  }

  /**
   * Sign a VersionedTransaction via OWS.
   * Used by Jupiter Ultra API which returns VersionedTransaction.
   */
  async signVersionedTx(tx: VersionedTransaction): Promise<VersionedTransaction> {
    const ows = await getOWS();
    const txHex = Buffer.from(tx.serialize()).toString('hex');
    const signedHex = ows.signTransaction(this.walletName, 'solana', txHex);
    return VersionedTransaction.deserialize(Buffer.from(signedHex, 'hex'));
  }

  /**
   * Estimate the priority fee for a transaction via Helius.
   * Falls back to 0 on any failure (network, auth, parse, etc.).
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
          params: [{ transaction: txBase64, options: { priorityLevel: level } }],
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
