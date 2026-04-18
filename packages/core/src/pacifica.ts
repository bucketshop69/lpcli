import bs58 from 'bs58';
import type { WalletService } from './wallet.js';

// ============================================================================
// Types
// ============================================================================

export interface PacificaSignatureHeader {
  type: string;
  timestamp: number;
  expiry_window: number;
}

export interface PacificaRequestEnvelope {
  account: string;
  signature: string;
  timestamp: number;
  expiry_window: number;
  [key: string]: unknown;
}

// ============================================================================
// Message preparation
// ============================================================================

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonKeys);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortJsonKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function preparePacificaMessage(
  header: PacificaSignatureHeader,
  payload: Record<string, unknown>,
): string {
  if (!header.type) throw new Error('Header missing required field: type');
  if (header.timestamp === undefined) throw new Error('Header missing required field: timestamp');
  if (header.expiry_window === undefined) throw new Error('Header missing required field: expiry_window');

  const data = { ...header, data: payload };
  const sorted = sortJsonKeys(data);
  return JSON.stringify(sorted);
}

// ============================================================================
// Signing
// ============================================================================

export async function signPacificaRequest(
  wallet: WalletService,
  header: PacificaSignatureHeader,
  payload: Record<string, unknown>,
): Promise<PacificaRequestEnvelope> {
  const message = preparePacificaMessage(header, payload);
  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = await wallet.signMessage(messageBytes);
  const signature = bs58.encode(signatureBytes);

  return {
    account: wallet.getPublicKey().toBase58(),
    signature,
    timestamp: header.timestamp,
    expiry_window: header.expiry_window,
    ...payload,
  };
}
