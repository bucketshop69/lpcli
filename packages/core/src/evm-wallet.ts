// ============================================================================
// EVM Wallet Service — @lpcli/core
//
// EVM signing via OWS (@open-wallet-standard/core).
// Same OWS wallet, different chain (eip155 / secp256k1).
// No raw private keys — OWS encrypts at rest, decrypts only for signing.
// ============================================================================

// ============================================================================
// Types
// ============================================================================

export interface EvmSignResult {
  /** Hex-encoded signature (0x-prefixed) */
  signature: string;
  /** Recovery ID (v value for EVM, 27 or 28) */
  recoveryId?: number;
}

export interface EvmSendResult {
  /** Transaction hash */
  txHash: string;
}

// ============================================================================
// OWS SDK — lazy loaded to avoid hard compile-time dependency
// ============================================================================

interface OWSSignResult {
  signature: string;
  recoveryId?: number;
}

interface OWSSendResult {
  txHash: string;
}

interface OWSSdk {
  getWallet(nameOrId: string): {
    id: string;
    name: string;
    accounts: { chainId: string; address: string }[];
  };
  signTransaction(wallet: string, chain: string, txHex: string): OWSSignResult;
  signMessage(wallet: string, chain: string, message: string, passphrase?: string, encoding?: string): OWSSignResult;
  signTypedData(wallet: string, chain: string, typedDataJson: string): OWSSignResult;
  signAndSend(wallet: string, chain: string, txHex: string, passphrase?: string, index?: number, rpcUrl?: string): OWSSendResult;
}

let _ows: OWSSdk | null = null;

async function getOWS(): Promise<OWSSdk> {
  if (_ows) return _ows;
  const dynamicImport = new Function('specifier', 'return import(specifier)');
  const mod = await dynamicImport('@open-wallet-standard/core') as OWSSdk;
  _ows = mod;
  return _ows;
}

// ============================================================================
// EvmWalletService
// ============================================================================

export class EvmWalletService {
  private walletName: string;
  private _address: string;
  private _rpcUrl: string | undefined;

  private constructor(walletName: string, address: string, rpcUrl?: string) {
    this.walletName = walletName;
    this._address = address;
    this._rpcUrl = rpcUrl;
  }

  /**
   * Initialise EvmWalletService from an OWS wallet.
   *
   * @param walletName - OWS wallet name (e.g. "lpcli")
   * @param rpcUrl - Optional Polygon/EVM RPC URL for signAndSend
   */
  static async init(walletName: string, rpcUrl?: string): Promise<EvmWalletService> {
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

    const evmAccount = wallet.accounts.find(
      (a) => a.chainId.startsWith('eip155:')
    );
    if (!evmAccount) {
      throw new Error(`OWS wallet "${walletName}" has no EVM account.`);
    }

    return new EvmWalletService(walletName, evmAccount.address, rpcUrl);
  }

  /** Return the wallet's EVM (Polygon) address. */
  getAddress(): string {
    return this._address;
  }

  /** Return the configured RPC URL. */
  getRpcUrl(): string | undefined {
    return this._rpcUrl;
  }

  /**
   * Sign an EIP-191 personal message via OWS.
   * Used for generic message signing.
   */
  async signMessage(message: string): Promise<EvmSignResult> {
    const ows = await getOWS();
    const result = ows.signMessage(this.walletName, 'ethereum', message);
    return {
      signature: result.signature.startsWith('0x') ? result.signature : `0x${result.signature}`,
      recoveryId: result.recoveryId,
    };
  }

  /**
   * Sign EIP-712 typed structured data via OWS.
   * Used for Polymarket CLOB authentication.
   *
   * @param typedData - EIP-712 typed data object (will be JSON-stringified)
   */
  async signTypedData(typedData: Record<string, unknown>): Promise<EvmSignResult> {
    const ows = await getOWS();
    const json = typeof typedData === 'string' ? typedData : JSON.stringify(typedData);
    const result = ows.signTypedData(this.walletName, 'ethereum', json);
    return {
      signature: result.signature.startsWith('0x') ? result.signature : `0x${result.signature}`,
      recoveryId: result.recoveryId,
    };
  }

  /**
   * Sign a raw EVM transaction via OWS.
   * Returns the signature only — does NOT broadcast.
   *
   * @param txHex - Hex-encoded unsigned transaction bytes (RLP-encoded)
   */
  async signTransaction(txHex: string): Promise<EvmSignResult> {
    const ows = await getOWS();
    const hex = txHex.startsWith('0x') ? txHex.slice(2) : txHex;
    const result = ows.signTransaction(this.walletName, 'ethereum', hex);
    return {
      signature: result.signature.startsWith('0x') ? result.signature : `0x${result.signature}`,
      recoveryId: result.recoveryId,
    };
  }

  /**
   * Sign and broadcast an EVM transaction via OWS.
   * OWS handles RPC submission.
   *
   * @param txHex - Hex-encoded unsigned transaction bytes
   * @param rpcUrl - Optional RPC URL override (defaults to constructor rpcUrl)
   */
  async signAndSend(txHex: string, rpcUrl?: string): Promise<EvmSendResult> {
    const url = rpcUrl ?? this._rpcUrl;
    if (!url) {
      throw new Error('No RPC URL configured. Pass rpcUrl to init() or signAndSend().');
    }

    const ows = await getOWS();
    const hex = txHex.startsWith('0x') ? txHex.slice(2) : txHex;
    const result = ows.signAndSend(
      this.walletName,
      'ethereum',
      hex,
      undefined, // passphrase
      undefined, // index
      url,
    );
    return { txHash: result.txHash };
  }
}
