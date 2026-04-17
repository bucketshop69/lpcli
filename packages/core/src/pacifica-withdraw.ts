// ============================================================================
// pacific Withdraw — @lpcli/core
//
// Builds a signed withdrawal request and submits it to the pacific API.
// Uses signpacificRequest from pacific.ts for message signing.
// ============================================================================

import type { WalletService } from './wallet.js';
import { signpacificRequest } from './pacific.js';
import { pacificClient } from './pacific-client.js';

/**
 * Request a withdrawal from pacific.
 *
 * Signs the request via OWS and submits it to the pacific REST API.
 *
 * @param wallet - WalletService instance for signing.
 * @param amountUsdc - Amount to withdraw in human units (e.g. 50.0 = $50).
 * @param client - Optional pacificClient (uses default if not provided).
 */
export async function requestWithdrawal(
  wallet: WalletService,
  amountUsdc: number,
  client?: pacificClient,
): Promise<void> {
  const header = {
    type: 'request_withdrawal',
    timestamp: Date.now(),
    expiry_window: 5000,
  };
  const payload = {
    amount: amountUsdc.toString(),
  };

  const envelope = await signpacificRequest(wallet, header, payload);
  const c = client ?? new pacificClient();
  await c.requestWithdrawal(envelope);
}
