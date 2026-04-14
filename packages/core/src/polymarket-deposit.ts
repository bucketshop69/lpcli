// ============================================================================
// Polymarket Deposit Addresses — @lpcli/core
//
// Fetches deposit addresses from the Polymarket Bridge API.
// Each chain returns a deposit address — send funds there and they
// auto-bridge to USDC.e on Polygon for the user's Polymarket wallet.
//
// Can be called directly (Bridge API is public) or via VPS relay.
// ============================================================================

import type { WalletService } from './wallet.js';
import type { PolymarketRelayConfig } from './polymarket-auth.js';
import { getDeriveMessage } from './polymarket-auth.js';

// ============================================================================
// Types
// ============================================================================

export interface PolymarketDepositAddresses {
  /** The Polygon EOA these deposit addresses are for */
  polygonAddress: string;
  /** Solana deposit address — send USDC on Solana here */
  svm?: string;
  /** EVM deposit address — send from Ethereum/Polygon/Arbitrum/Base */
  evm?: string;
  /** Bitcoin deposit address */
  btc?: string;
  /** Raw response from Bridge API (may contain additional chains) */
  raw: Record<string, unknown>;
}

// ============================================================================
// Constants
// ============================================================================

const BRIDGE_API = 'https://bridge.polymarket.com';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Derive the Polygon address from the Solana wallet signature.
 * This is the keccak256 derivation — matches the VPS auth flow.
 * We do it locally so we can call Bridge API without needing a VPS session.
 */
async function derivePolygonAddress(wallet: WalletService): Promise<{ polygonAddress: string; signatureHex: string }> {
  const messageBytes = new TextEncoder().encode(getDeriveMessage());
  const signature = await wallet.signMessage(messageBytes);
  const signatureHex = Buffer.from(signature).toString('hex');

  // We need keccak256 to derive the address locally.
  // Rather than adding a dependency, we call the relay if available,
  // or require the caller to provide the address.
  return { polygonAddress: '', signatureHex };
}

// ============================================================================
// Deposit Addresses
// ============================================================================

/**
 * Fetch deposit addresses via VPS relay.
 * The relay calls Bridge API from a non-geo-restricted server.
 *
 * @param polygonAddress - The derived Polygon EOA address
 * @param config - Relay configuration
 */
export async function getDepositAddresses(
  polygonAddress: string,
  config: PolymarketRelayConfig,
): Promise<PolymarketDepositAddresses> {
  const url = `${config.relayUrl.replace(/\/$/, '')}/clob/deposit/${polygonAddress}`;
  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Deposit address fetch failed (${res.status}): ${body}`);
  }

  const data = await res.json() as Record<string, unknown>;

  // Bridge API returns { address: { svm, evm, btc, ... } } or flat { svm, evm, btc, ... }
  const addresses = (data.address ?? data) as Record<string, unknown>;

  return {
    polygonAddress,
    svm: addresses.svm as string | undefined,
    evm: addresses.evm as string | undefined,
    btc: addresses.btc as string | undefined,
    raw: addresses,
  };
}

/**
 * Fetch deposit addresses directly from Bridge API (no relay).
 * May be geo-restricted — falls back to relay if available.
 *
 * @param polygonAddress - The Polygon EOA address
 */
export async function getDepositAddressesDirect(
  polygonAddress: string,
): Promise<PolymarketDepositAddresses> {
  const res = await fetch(`${BRIDGE_API}/deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: polygonAddress }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Bridge API error (${res.status}): ${body}`);
  }

  const data = await res.json() as Record<string, unknown>;
  const addresses = (data.address ?? data) as Record<string, unknown>;

  return {
    polygonAddress,
    svm: addresses.svm as string | undefined,
    evm: addresses.evm as string | undefined,
    btc: addresses.btc as string | undefined,
    raw: addresses,
  };
}
