// ============================================================================
// Polymarket Auth — @lpcli/core
//
// Authenticates with Polymarket CLOB via a VPS relay.
// Flow:
// 1. Sign a deterministic message with the Solana key (OWS)
// 2. Send the 64-byte signature to VPS POST /clob/auth
// 3. VPS derives EVM key via keccak256(signature), creates CLOB session
// 4. Returns the derived Polygon address for subsequent calls
//
// The VPS relay bypasses CLOB geo-restrictions. All CLOB-authenticated
// operations go through the relay; the private key never leaves OWS.
// ============================================================================

import type { WalletService } from './wallet.js';

// ============================================================================
// Types
// ============================================================================

export interface PolymarketAuthResult {
  /** Derived Polygon EOA address (from keccak256 of Solana signature) */
  polygonAddress: string;
}

export interface PolymarketRelayConfig {
  /** VPS relay base URL (e.g. "https://api.example.com") */
  relayUrl: string;
}

// ============================================================================
// Constants
// ============================================================================

/** The deterministic message signed by the Solana key to derive the EVM key.
 *  Shared across all clients (myboon, lpcli, x402) — same wallet = same Polygon address. */
const DERIVE_MESSAGE = 'myboon:polymarket:enable';

// ============================================================================
// Auth
// ============================================================================

/**
 * Authenticate with Polymarket CLOB via the VPS relay.
 *
 * Signs a deterministic message with the Solana key, sends the signature
 * to the VPS, which derives the same EVM key and creates a CLOB session.
 *
 * @param wallet - WalletService (Solana, for signing)
 * @param config - Relay configuration
 * @returns The derived Polygon address for subsequent relay calls
 */
export async function polymarketAuth(
  wallet: WalletService,
  config: PolymarketRelayConfig,
): Promise<PolymarketAuthResult> {
  // Step 1: Sign the deterministic message with Solana key
  const messageBytes = new TextEncoder().encode(DERIVE_MESSAGE);
  const signature = await wallet.signMessage(messageBytes);

  // Step 2: Send to VPS relay
  const signatureHex = Buffer.from(signature).toString('hex');

  const url = `${config.relayUrl.replace(/\/$/, '')}/clob/auth`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signature: signatureHex }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Polymarket auth failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { polygonAddress?: string; ok?: boolean; error?: string };

  if (!data.polygonAddress) {
    throw new Error(`Polymarket auth: unexpected response — ${JSON.stringify(data)}`);
  }

  return { polygonAddress: data.polygonAddress };
}

/**
 * Get the derived Polygon address without creating a session.
 *
 * Useful for checking deposit addresses or on-chain balances
 * before authenticating with CLOB.
 *
 * Signs the same deterministic message and derives the address locally
 * using keccak256. Requires the keccak256 implementation.
 */
export function getDeriveMessage(): string {
  return DERIVE_MESSAGE;
}
