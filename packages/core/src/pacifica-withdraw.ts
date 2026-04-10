// ============================================================================
// Pacifica Withdraw — @lpcli/core
//
// Builds a signed withdrawal request and submits it to the Pacifica API.
// Uses signPacificaRequest from pacifica.ts for message signing.
// ============================================================================

import type { WalletService } from './wallet.js';
import { signPacificaRequest } from './pacifica.js';
import { PacificaClient } from './pacifica-client.js';

/**
 * Request a withdrawal from Pacifica.
 *
 * Signs the request via OWS and submits it to the Pacifica REST API.
 *
 * @param wallet - WalletService instance for signing.
 * @param amountUsdc - Amount to withdraw in human units (e.g. 50.0 = $50).
 * @param client - Optional PacificaClient (uses default if not provided).
 */
export async function requestWithdrawal(
  wallet: WalletService,
  amountUsdc: number,
  client?: PacificaClient,
): Promise<void> {
  const header = {
    type: 'request_withdrawal',
    timestamp: Date.now(),
    expiry_window: 5000,
  };
  const payload = {
    amount: amountUsdc.toString(),
  };

  const envelope = await signPacificaRequest(wallet, header, payload);
  const c = client ?? new PacificaClient();
  await c.requestWithdrawal(envelope);
}
