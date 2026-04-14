// ============================================================================
// Polymarket Positions — @lpcli/core
//
// Read wallet balances and positions on Polygon.
// Balance check is on-chain (Polygon RPC, no relay needed).
// CLOB balance/positions go through the VPS relay.
// ============================================================================

import type { PolymarketRelayConfig } from './polymarket-auth.js';
import { checkAllowances } from './polymarket-approve.js';
import type { PolymarketAllowances } from './polymarket-approve.js';

// ============================================================================
// Types
// ============================================================================

export interface PolymarketBalance {
  /** Polygon address */
  polygonAddress: string;
  /** USDC.e balance on Polygon */
  usdceBalance: number;
  /** POL (gas token) balance */
  polBalance: number;
  /** CLOB-reported balance (may differ from on-chain due to pending orders) */
  clobBalance?: number;
  /** CLOB-reported allowance */
  clobAllowance?: number;
}

export interface PolymarketPosition {
  /** Market title / question */
  title?: string;
  /** Outcome (YES/NO) */
  outcome?: string;
  /** Token ID */
  tokenId: string;
  /** Number of shares held */
  size: number;
  /** Average entry price */
  avgPrice?: number;
  /** Current market price */
  currentPrice?: number;
  /** Unrealized PnL */
  pnl?: number;
}

// ============================================================================
// Balance
// ============================================================================

/**
 * Get full balance info for a Polygon address.
 * Combines on-chain reads with CLOB balance from relay.
 */
export async function getBalance(
  polygonAddress: string,
  config?: PolymarketRelayConfig,
): Promise<PolymarketBalance> {
  // On-chain balances (no relay needed)
  const onChain = await checkAllowances(polygonAddress);

  const result: PolymarketBalance = {
    polygonAddress,
    usdceBalance: onChain.usdceBalance,
    polBalance: onChain.polBalance,
  };

  // CLOB balance via relay (if available)
  if (config?.relayUrl) {
    try {
      const url = `${config.relayUrl.replace(/\/$/, '')}/clob/balance/${polygonAddress}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json() as { balance?: number; allowance?: number };
        result.clobBalance = data.balance;
        result.clobAllowance = data.allowance;
      }
    } catch {
      // Relay unavailable — on-chain data is still valid
    }
  }

  return result;
}

/**
 * Get allowance status — re-export for convenience.
 */
export { checkAllowances };
export type { PolymarketAllowances };

// ============================================================================
// Positions
// ============================================================================

/**
 * Get open orders / positions from CLOB via relay.
 */
export async function getPositions(
  polygonAddress: string,
  config: PolymarketRelayConfig,
): Promise<Record<string, unknown>[]> {
  const url = `${config.relayUrl.replace(/\/$/, '')}/clob/positions/${polygonAddress}`;
  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Positions fetch failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { orders?: Record<string, unknown>[] };
  return data.orders ?? [];
}
