// ============================================================================
// Polymarket Allowance & Approval — @lpcli/core
//
// Checks USDC.e allowances to Polymarket exchange contracts on Polygon.
// Approvals are sent via the VPS relay (the derived key lives there).
//
// Contracts:
//   USDC.e:              0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
//   CTF:                 0x4D97DCd97eC945f40cF65F87097ACe5EA0476045
//   CTF Exchange:        0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E
//   Neg Risk Exchange:   0xC5d563A36AE78145C45a50134d48A1215220f80a
//   Neg Risk Adapter:    0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296
// ============================================================================

import type { PolymarketRelayConfig } from './polymarket-auth.js';

// ============================================================================
// Types
// ============================================================================

export interface AllowanceStatus {
  /** Spender contract name */
  name: string;
  /** Spender contract address */
  spender: string;
  /** Current allowance in USDC.e (human-readable) */
  allowance: number;
  /** Whether allowance is effectively unlimited */
  unlimited: boolean;
}

export interface PolymarketAllowances {
  /** The Polygon EOA being checked */
  polygonAddress: string;
  /** USDC.e balance on Polygon */
  usdceBalance: number;
  /** POL (gas token) balance */
  polBalance: number;
  /** Allowance status for each exchange contract */
  allowances: AllowanceStatus[];
  /** Whether all required contracts are approved */
  allApproved: boolean;
}

export interface ApprovalResult {
  /** Transaction hash */
  txHash: string;
  /** Which contract was approved */
  spender: string;
  name: string;
}

// ============================================================================
// Constants
// ============================================================================

const USDC_E = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const CTF = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

export const POLYMARKET_SPENDERS = [
  { name: 'CTF Exchange', address: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E' },
  { name: 'Neg Risk Exchange', address: '0xC5d563A36AE78145C45a50134d48A1215220f80a' },
  { name: 'Neg Risk Adapter', address: '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296' },
] as const;

// ABI selectors
const BALANCE_OF_SELECTOR = '0x70a08231';
const ALLOWANCE_SELECTOR = '0xdd62ed3e';

// Polygon public RPCs (fallback chain)
const POLYGON_RPCS = [
  'https://polygon-bor-rpc.publicnode.com',
  'https://1rpc.io/matic',
  'https://polygon.drpc.org',
];

// ============================================================================
// Helpers
// ============================================================================

function padAddress(addr: string): string {
  return addr.slice(2).toLowerCase().padStart(64, '0');
}

async function polygonRpcCall(method: string, params: unknown[]): Promise<string> {
  for (const rpc of POLYGON_RPCS) {
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const json = await res.json() as { result?: string; error?: unknown };
      if (json.error) continue;
      if (json.result) return json.result;
    } catch {
      continue;
    }
  }
  throw new Error('All Polygon RPCs failed');
}

// ============================================================================
// Read — Allowance Check
// ============================================================================

/**
 * Check USDC.e allowances and balances for a Polygon address.
 * Pure on-chain reads via Polygon RPC — no relay needed.
 */
export async function checkAllowances(polygonAddress: string): Promise<PolymarketAllowances> {
  const addr = padAddress(polygonAddress);

  // Fetch POL balance
  const polHex = await polygonRpcCall('eth_getBalance', [polygonAddress, 'latest']);
  const polBalance = Number(BigInt(polHex)) / 1e18;

  // Fetch USDC.e balance
  const usdceData = BALANCE_OF_SELECTOR + addr;
  const usdceHex = await polygonRpcCall('eth_call', [{ to: USDC_E, data: usdceData }, 'latest']);
  const usdceBalance = Number(BigInt(usdceHex)) / 1e6;

  // Fetch allowances for each spender
  const allowances: AllowanceStatus[] = [];

  for (const spender of POLYMARKET_SPENDERS) {
    const data = ALLOWANCE_SELECTOR + addr + padAddress(spender.address);
    const hex = await polygonRpcCall('eth_call', [{ to: USDC_E, data }, 'latest']);
    const raw = BigInt(hex);
    const amount = Number(raw) / 1e6;
    // Consider "unlimited" if > 1 trillion USDC
    const unlimited = raw > BigInt(1e18);

    allowances.push({
      name: spender.name,
      spender: spender.address,
      allowance: amount,
      unlimited,
    });
  }

  return {
    polygonAddress,
    usdceBalance,
    polBalance,
    allowances,
    allApproved: allowances.every(a => a.unlimited),
  };
}

// ============================================================================
// Write — Approve via Relay
// ============================================================================

/**
 * Approve USDC.e spending for all Polymarket exchange contracts via VPS relay.
 * The relay signs the on-chain approve tx with the derived key.
 *
 * Requires the VPS to have a POST /clob/approve endpoint.
 */
export async function approveViaRelay(
  polygonAddress: string,
  config: PolymarketRelayConfig,
): Promise<ApprovalResult[]> {
  const url = `${config.relayUrl.replace(/\/$/, '')}/clob/approve`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ polygonAddress }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Approval via relay failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<ApprovalResult[]>;
}
