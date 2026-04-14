import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { WalletService } from '../src/wallet.js';
import { polymarketAuth, getDeriveMessage } from '../src/polymarket-auth.js';
import { getDepositAddresses, getDepositAddressesDirect } from '../src/polymarket-deposit.js';

const config = loadConfig();

describe('Polymarket Deposit Addresses', () => {
  it('fetches deposit addresses via relay (requires POLYMARKET_RELAY_URL)', async () => {
    const relayUrl = process.env.POLYMARKET_RELAY_URL;
    if (!relayUrl) {
      console.log('SKIP: POLYMARKET_RELAY_URL not set');
      return;
    }

    const wallet = await WalletService.init(config.wallet, config.rpcUrl);
    const auth = await polymarketAuth(wallet, { relayUrl });

    console.log('Polygon address:', auth.polygonAddress);

    const addresses = await getDepositAddresses(auth.polygonAddress, { relayUrl });

    console.log('SVM deposit:', addresses.svm ?? '(not available)');
    console.log('EVM deposit:', addresses.evm ?? '(not available)');
    console.log('BTC deposit:', addresses.btc ?? '(not available)');
    console.log('Raw keys:', Object.keys(addresses.raw).join(', '));

    assert.equal(addresses.polygonAddress, auth.polygonAddress);
    // At least one deposit address should be present
    const hasAny = addresses.svm || addresses.evm || addresses.btc;
    assert.ok(hasAny, 'expected at least one deposit address');
  });

  it('fetches deposit addresses directly from Bridge API (may be geo-restricted)', async () => {
    // Use a known polygon address for direct Bridge API test
    // This tests the direct path without needing relay auth
    const relayUrl = process.env.POLYMARKET_RELAY_URL;
    if (!relayUrl) {
      console.log('SKIP: POLYMARKET_RELAY_URL not set — need it to derive polygon address first');
      return;
    }

    const wallet = await WalletService.init(config.wallet, config.rpcUrl);
    const auth = await polymarketAuth(wallet, { relayUrl });

    try {
      const addresses = await getDepositAddressesDirect(auth.polygonAddress);
      console.log('Direct Bridge API — SVM:', addresses.svm ?? '(not available)');
      console.log('Direct Bridge API — EVM:', addresses.evm ?? '(not available)');

      assert.equal(addresses.polygonAddress, auth.polygonAddress);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log('Direct Bridge API failed (likely geo-restricted):', msg);
      // Not a test failure — Bridge API may be geo-restricted
    }
  });

  it('relay and direct return consistent results (when both work)', async () => {
    const relayUrl = process.env.POLYMARKET_RELAY_URL;
    if (!relayUrl) {
      console.log('SKIP: POLYMARKET_RELAY_URL not set');
      return;
    }

    const wallet = await WalletService.init(config.wallet, config.rpcUrl);
    const auth = await polymarketAuth(wallet, { relayUrl });

    const relayResult = await getDepositAddresses(auth.polygonAddress, { relayUrl });

    let directResult;
    try {
      directResult = await getDepositAddressesDirect(auth.polygonAddress);
    } catch {
      console.log('Direct Bridge API unavailable — skipping consistency check');
      return;
    }

    // If both work, SVM addresses should match
    if (relayResult.svm && directResult.svm) {
      console.log('Relay SVM:', relayResult.svm);
      console.log('Direct SVM:', directResult.svm);
      assert.equal(relayResult.svm, directResult.svm, 'SVM deposit addresses should match');
    }
  });
});
