// ============================================================================
// Wallet Service — @lpcli/core
//
// All signing goes through OWS (@open-wallet-standard/core).
// No raw private keys — OWS encrypts at rest, decrypts only for signing.
// ============================================================================

import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  AccountLayout,
} from '@solana/spl-token';

// ============================================================================
// Types
// ============================================================================

export interface TokenBalance {
  mint: string;
  /** Raw amount in smallest unit (lamports for SOL, etc.) */
  amount: string;
  /** Decimal-adjusted balance */
  uiAmount: number;
  decimals: number;
}

export interface WalletBalances {
  address: string;
  solBalance: number;
  /** SOL balance in lamports */
  solLamports: number;
  tokens: TokenBalance[];
}

export interface TransferResult {
  signature: string;
  from: string;
  to: string;
  amount: number;
  /** 'SOL' or mint address */
  token: string;
}

// ============================================================================
// OWS SDK — lazy loaded to avoid hard compile-time dependency
// ============================================================================

interface OWSSignResult {
  signature: string;      // Hex-encoded signed transaction
  recoveryId?: number;
}

interface OWSSdk {
  getWallet(nameOrId: string): { id: string; name: string; accounts: { chainId: string; address: string }[] };
  signTransaction(wallet: string, chain: string, txHex: string): OWSSignResult;
  signMessage(wallet: string, chain: string, message: string): OWSSignResult;
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
    const result = ows.signTransaction(this.walletName, 'solana', txHex);
    // OWS returns just the cryptographic signature — apply it to the transaction
    const sigBytes = Buffer.from(result.signature, 'hex');
    tx.addSignature(this._publicKey, sigBytes);
    return tx;
  }

  /**
   * Sign a VersionedTransaction via OWS.
   * Used by Jupiter Ultra API which returns VersionedTransaction.
   */
  async signVersionedTx(tx: VersionedTransaction): Promise<VersionedTransaction> {
    const ows = await getOWS();
    const txHex = Buffer.from(tx.serialize()).toString('hex');
    const result = ows.signTransaction(this.walletName, 'solana', txHex);
    // OWS returns just the cryptographic signature — apply it to the transaction
    const sigBytes = Buffer.from(result.signature, 'hex');
    tx.addSignature(this._publicKey, sigBytes);
    return tx;
  }

  /**
   * Sign an arbitrary message via OWS.
   * Returns the raw 64-byte ed25519 signature.
   */
  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const ows = await getOWS();
    const messageStr = new TextDecoder().decode(message);
    const result = ows.signMessage(this.walletName, 'solana', messageStr);
    return new Uint8Array(Buffer.from(result.signature, 'hex'));
  }

  /** Return the underlying Connection (for token account lookups, etc.) */
  getConnection(): Connection {
    return this.connection;
  }

  /**
   * Get the raw token balance for a specific mint.
   * Returns { amount (raw string), uiAmount, decimals } or null if no account.
   * Uses getTokenAccountBalance on the ATA — single lightweight RPC call.
   */
  async getTokenBalance(mint: string): Promise<TokenBalance | null> {
    const mintPubKey = new PublicKey(mint);
    const ata = await getAssociatedTokenAddress(mintPubKey, this._publicKey);
    try {
      const resp = await this.connection.getTokenAccountBalance(ata);
      return {
        mint,
        amount: resp.value.amount,
        uiAmount: resp.value.uiAmount ?? 0,
        decimals: resp.value.decimals,
      };
    } catch {
      // Account doesn't exist — zero balance
      return null;
    }
  }

  /**
   * Get SOL balance + balances for specific mints only.
   *
   * Uses getMultipleAccountsInfo to batch all lookups into a single RPC call:
   * derives ATAs locally with getAssociatedTokenAddressSync (zero RPC),
   * then fetches [walletAccount, ata1, ata2, ...] in one shot.
   *
   * @param knownDecimals Optional map of mint → decimals. When provided, avoids
   *   needing to fetch mint accounts. Callers with PoolMeta should pass this.
   *   Falls back to 9 for SOL, 6 for unknown SPL tokens.
   */
  async getMintBalances(
    mints: string[],
    knownDecimals?: Record<string, number>,
  ): Promise<WalletBalances> {
    const SOL = 'So11111111111111111111111111111111111111112';
    const unique = [...new Set(mints.filter(m => m !== SOL))];

    // Derive ATAs for both legacy and Token-2022 programs
    const legacyAtas = unique.map(mint =>
      getAssociatedTokenAddressSync(new PublicKey(mint), this._publicKey, false, TOKEN_PROGRAM_ID),
    );
    const token2022Atas = unique.map(mint =>
      getAssociatedTokenAddressSync(new PublicKey(mint), this._publicKey, false, TOKEN_2022_PROGRAM_ID),
    );

    // Single RPC call: wallet + legacy ATAs + Token-2022 ATAs
    const accounts = await this.connection.getMultipleAccountsInfo([
      this._publicKey,
      ...legacyAtas,
      ...token2022Atas,
    ]);

    const solLamports = accounts[0]?.lamports ?? 0;
    const tokens: TokenBalance[] = [];

    for (let i = 0; i < unique.length; i++) {
      // Try legacy first, then Token-2022
      const legacyAcct = accounts[1 + i];
      const t2022Acct = accounts[1 + unique.length + i];
      const accountInfo = (legacyAcct?.data && legacyAcct.data.length >= AccountLayout.span) ? legacyAcct : t2022Acct;

      if (!accountInfo?.data || accountInfo.data.length < AccountLayout.span) continue;

      const decoded = AccountLayout.decode(accountInfo.data);
      const rawAmount = decoded.amount;
      if (rawAmount === BigInt(0)) continue;

      const mint = unique[i];
      const decimals = knownDecimals?.[mint] ?? 6;
      tokens.push({
        mint,
        amount: rawAmount.toString(),
        uiAmount: Number(rawAmount) / 10 ** decimals,
        decimals,
      });
    }

    return {
      address: this._publicKey.toBase58(),
      solBalance: solLamports / LAMPORTS_PER_SOL,
      solLamports,
      tokens,
    };
  }

  /**
   * Get SOL balance + all SPL token balances for this wallet.
   * NOTE: This calls getParsedTokenAccountsByOwner which is heavy.
   * Prefer getMintBalances() when you know which mints you need.
   */
  async getBalances(): Promise<WalletBalances> {
    // Fetch SOL + legacy tokens + Token-2022 tokens in parallel
    const [solLamports, legacyAccounts, token2022Accounts] = await Promise.all([
      this.connection.getBalance(this._publicKey),
      this.connection.getParsedTokenAccountsByOwner(this._publicKey, { programId: TOKEN_PROGRAM_ID }),
      this.connection.getParsedTokenAccountsByOwner(this._publicKey, { programId: TOKEN_2022_PROGRAM_ID }),
    ]);

    const allAccounts = [...legacyAccounts.value, ...token2022Accounts.value];

    const tokens: TokenBalance[] = allAccounts
      .map((ta) => {
        const info = ta.account.data.parsed.info;
        return {
          mint: info.mint as string,
          amount: info.tokenAmount.amount as string,
          uiAmount: info.tokenAmount.uiAmount as number,
          decimals: info.tokenAmount.decimals as number,
        };
      })
      .filter((t) => t.uiAmount > 0);

    return {
      address: this._publicKey.toBase58(),
      solBalance: solLamports / LAMPORTS_PER_SOL,
      solLamports,
      tokens,
    };
  }

  /**
   * Transfer SOL to another address.
   * Amount is in SOL (not lamports).
   */
  async transferSOL(to: string, amountSol: number): Promise<TransferResult> {
    const toPubKey = new PublicKey(to);
    const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this._publicKey,
        toPubkey: toPubKey,
        lamports,
      })
    );

    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    tx.feePayer = this._publicKey;

    const signed = await this.signTx(tx);
    const signature = await this.connection.sendRawTransaction(signed.serialize());
    await this.connection.confirmTransaction(signature, 'confirmed');

    return {
      signature,
      from: this._publicKey.toBase58(),
      to,
      amount: amountSol,
      token: 'SOL',
    };
  }

  /**
   * Transfer SPL tokens to another address.
   * Amount is in token's smallest unit (raw amount).
   */
  async transferToken(params: {
    to: string;
    mint: string;
    amount: number;
  }): Promise<TransferResult> {
    const toPubKey = new PublicKey(params.to);
    const mintPubKey = new PublicKey(params.mint);

    // Get source token account
    const sourceATA = await getAssociatedTokenAddress(mintPubKey, this._publicKey);

    // Get or create destination token account
    // We need a payer signer — but OWS doesn't give us a Keypair.
    // Instead, build the instruction manually assuming the dest ATA exists or
    // the recipient has already created it. If not, we create it in the same tx.
    const destATA = await getAssociatedTokenAddress(mintPubKey, toPubKey);

    // Check if dest ATA exists
    const destAccount = await this.connection.getAccountInfo(destATA);

    const tx = new Transaction();

    if (!destAccount) {
      // Create associated token account for recipient
      const { createAssociatedTokenAccountInstruction } = await import('@solana/spl-token');
      tx.add(
        createAssociatedTokenAccountInstruction(
          this._publicKey, // payer
          destATA,         // ata
          toPubKey,        // owner
          mintPubKey       // mint
        )
      );
    }

    tx.add(
      createTransferInstruction(
        sourceATA,
        destATA,
        this._publicKey,
        params.amount
      )
    );

    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    tx.feePayer = this._publicKey;

    const signed = await this.signTx(tx);
    const signature = await this.connection.sendRawTransaction(signed.serialize());
    await this.connection.confirmTransaction(signature, 'confirmed');

    return {
      signature,
      from: this._publicKey.toBase58(),
      to: params.to,
      amount: params.amount,
      token: params.mint,
    };
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
