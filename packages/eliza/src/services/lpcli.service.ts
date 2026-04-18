/**
 * LpcliService — singleton LPCLI + PacificaClient for ElizaOS actions.
 *
 * Mirrors the MCP server singleton pattern (packages/mcp/src/index.ts:47-66).
 * Read-only operations use publicKey from the message context.
 * Write operations return unsigned payloads for browser signing.
 */

import { LPCLI, PacificaClient } from '@lpcli/core';
import type { ReadinessStatus, LPCLIConfig } from '@lpcli/core';
import type { IAgentRuntime } from '@elizaos/core';

let _lpcli: LPCLI | null = null;
let _pacific: PacificaClient | null = null;
let _readiness: ReadinessStatus | null = null;

export function initService(runtime: IAgentRuntime): void {
  const rpcUrl = runtime.getSetting('HELIUS_RPC_URL')
    || runtime.getSetting('RPC_URL')
    || runtime.getSetting('SOLANA_RPC_URL');

  const config: Partial<LPCLIConfig> = {};
  if (typeof rpcUrl === 'string') {
    config.rpcUrl = rpcUrl;
    config.readRpcUrl = rpcUrl;
  }

  _lpcli = new LPCLI(config);
  _pacific = new PacificaClient();
}

export function getLpcli(): LPCLI {
  if (!_lpcli) _lpcli = new LPCLI();
  return _lpcli;
}

export function getPacifica(): PacificaClient {
  if (!_pacific) _pacific = new PacificaClient();
  return _pacific;
}

/** Check wallet readiness (OWS available). */
export async function checkReady(): Promise<ReadinessStatus> {
  const lpcli = getLpcli();
  if (!_readiness?.ready) {
    _readiness = await lpcli.checkReady();
  }
  return _readiness;
}

/**
 * Get LPCLI with wallet initialised. Throws if OWS not available.
 * Used for local mode where OWS auto-signs.
 */
export async function requireWallet(): Promise<LPCLI> {
  const lpcli = getLpcli();
  if (!_readiness?.ready) {
    _readiness = await lpcli.checkReady();
  }
  if (!_readiness.ready) {
    throw new Error(`Wallet not available: ${_readiness.error}`);
  }
  return lpcli;
}
