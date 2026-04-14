import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { WalletService } from '../src/wallet.js';
import { polymarketAuth, getDeriveMessage } from '../src/polymarket-auth.js';

const config = loadConfig();

describe('Polymarket Auth', () => {
  it('signs the deterministic derive message with Solana key', async () => {
    const wallet = await WalletService.init(config.wallet, config.rpcUrl);
    const message = getDeriveMessage();
    const messageBytes = new TextEncoder().encode(message);
    const signature = await wallet.signMessage(messageBytes);

    console.log('Wallet:', wallet.getPublicKey().toBase58());
    console.log('Derive message:', message);
    console.log('Signature (hex):', Buffer.from(signature).toString('hex').slice(0, 40) + '...');

    // ed25519 signature = 64 bytes
    assert.equal(signature.length, 64, 'signature should be 64 bytes');
  });

  it('produces a deterministic signature (same wallet + message = same sig)', async () => {
    const wallet = await WalletService.init(config.wallet, config.rpcUrl);
    const messageBytes = new TextEncoder().encode(getDeriveMessage());

    const sig1 = await wallet.signMessage(messageBytes);
    const sig2 = await wallet.signMessage(messageBytes);

    const hex1 = Buffer.from(sig1).toString('hex');
    const hex2 = Buffer.from(sig2).toString('hex');

    console.log('Sig 1:', hex1.slice(0, 40) + '...');
    console.log('Sig 2:', hex2.slice(0, 40) + '...');

    assert.equal(hex1, hex2, 'same wallet + same message should produce identical signatures');
  });

  it('authenticates with VPS relay (requires POLYMARKET_RELAY_URL)', async () => {
    const relayUrl = process.env.POLYMARKET_RELAY_URL;
    if (!relayUrl) {
      console.log('SKIP: POLYMARKET_RELAY_URL not set — cannot test relay auth');
      return;
    }

    const wallet = await WalletService.init(config.wallet, config.rpcUrl);
    const result = await polymarketAuth(wallet, { relayUrl });

    console.log('Polygon address (derived):', result.polygonAddress);

    assert.ok(result.polygonAddress.startsWith('0x'), 'address should start with 0x');
    assert.equal(result.polygonAddress.length, 42, 'address should be 42 chars');
  });

  it('relay auth is deterministic (same wallet = same polygon address)', async () => {
    const relayUrl = process.env.POLYMARKET_RELAY_URL;
    if (!relayUrl) {
      console.log('SKIP: POLYMARKET_RELAY_URL not set');
      return;
    }

    const wallet = await WalletService.init(config.wallet, config.rpcUrl);
    const result1 = await polymarketAuth(wallet, { relayUrl });
    const result2 = await polymarketAuth(wallet, { relayUrl });

    console.log('Address 1:', result1.polygonAddress);
    console.log('Address 2:', result2.polygonAddress);

    assert.equal(
      result1.polygonAddress.toLowerCase(),
      result2.polygonAddress.toLowerCase(),
      'same wallet should always derive the same polygon address',
    );
  });
});
