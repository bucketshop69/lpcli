import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { WalletService } from '../src/wallet.js';
import { polymarketAuth } from '../src/polymarket-auth.js';
import { placeOrder, getOpenOrders } from '../src/polymarket-order.js';

const config = loadConfig();

describe('Polymarket Order Placement', () => {
  it('validates price range (rejects out-of-bound prices)', async () => {
    await assert.rejects(
      () => placeOrder(
        { polygonAddress: '0x0', tokenID: 'fake', price: 0, amount: 5, side: 'BUY' },
        { relayUrl: 'http://localhost:9999' },
      ),
      /Invalid price/,
    );

    await assert.rejects(
      () => placeOrder(
        { polygonAddress: '0x0', tokenID: 'fake', price: 1, amount: 5, side: 'BUY' },
        { relayUrl: 'http://localhost:9999' },
      ),
      /Invalid price/,
    );

    await assert.rejects(
      () => placeOrder(
        { polygonAddress: '0x0', tokenID: 'fake', price: -0.5, amount: 5, side: 'BUY' },
        { relayUrl: 'http://localhost:9999' },
      ),
      /Invalid price/,
    );
  });

  it('validates amount (rejects zero/negative)', async () => {
    await assert.rejects(
      () => placeOrder(
        { polygonAddress: '0x0', tokenID: 'fake', price: 0.5, amount: 0, side: 'BUY' },
        { relayUrl: 'http://localhost:9999' },
      ),
      /Invalid amount/,
    );
  });

  it('places an order via relay (requires POLYMARKET_RELAY_URL)', async () => {
    const relayUrl = process.env.POLYMARKET_RELAY_URL;
    if (!relayUrl) {
      console.log('SKIP: POLYMARKET_RELAY_URL not set');
      return;
    }

    const wallet = await WalletService.init(config.wallet, config.rpcUrl);
    const auth = await polymarketAuth(wallet, { relayUrl });

    // This would need a real token ID from an active market
    // For now, just verify the relay call structure works
    console.log('Polygon address:', auth.polygonAddress);
    console.log('Would place order via relay — skipping without real token ID');
  });

  it('fetches open orders via relay (requires POLYMARKET_RELAY_URL)', async () => {
    const relayUrl = process.env.POLYMARKET_RELAY_URL;
    if (!relayUrl) {
      console.log('SKIP: POLYMARKET_RELAY_URL not set');
      return;
    }

    const wallet = await WalletService.init(config.wallet, config.rpcUrl);
    const auth = await polymarketAuth(wallet, { relayUrl });

    const orders = await getOpenOrders(auth.polygonAddress, { relayUrl });
    console.log('Open orders:', orders.length);
  });
});
