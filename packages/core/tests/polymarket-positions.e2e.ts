import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { WalletService } from '../src/wallet.js';
import { polymarketAuth } from '../src/polymarket-auth.js';
import { getBalance } from '../src/polymarket-positions.js';
import { checkAllowances } from '../src/polymarket-approve.js';

const config = loadConfig();

describe('Polymarket Positions & Balance', () => {
  // POC wallet with known balances
  const KNOWN_WALLET = '0xFf24B17B582d3261c816D2d97Db5F633E12e9F03';

  it('reads on-chain balance without relay', async () => {
    const balance = await getBalance(KNOWN_WALLET);

    console.log('Address:', balance.polygonAddress);
    console.log('USDC.e:', balance.usdceBalance.toFixed(6));
    console.log('POL:', balance.polBalance.toFixed(6));

    assert.equal(balance.polygonAddress, KNOWN_WALLET);
    assert.ok(balance.usdceBalance > 0, 'POC wallet should have USDC.e');
    assert.ok(balance.polBalance > 0, 'POC wallet should have POL');
    // No relay → no CLOB data
    assert.equal(balance.clobBalance, undefined);
  });

  it('reads balance with CLOB data via relay (requires POLYMARKET_RELAY_URL)', async () => {
    const relayUrl = process.env.POLYMARKET_RELAY_URL;
    if (!relayUrl) {
      console.log('SKIP: POLYMARKET_RELAY_URL not set');
      return;
    }

    const wallet = await WalletService.init(config.wallet, config.rpcUrl);
    const auth = await polymarketAuth(wallet, { relayUrl });

    const balance = await getBalance(auth.polygonAddress, { relayUrl });

    console.log('Polygon address:', balance.polygonAddress);
    console.log('USDC.e:', balance.usdceBalance.toFixed(6));
    console.log('POL:', balance.polBalance.toFixed(6));
    console.log('CLOB balance:', balance.clobBalance ?? 'N/A');
    console.log('CLOB allowance:', balance.clobAllowance ?? 'N/A');
  });

  it('reads allowance status for derived wallet via relay', async () => {
    const relayUrl = process.env.POLYMARKET_RELAY_URL;
    if (!relayUrl) {
      console.log('SKIP: POLYMARKET_RELAY_URL not set');
      return;
    }

    const wallet = await WalletService.init(config.wallet, config.rpcUrl);
    const auth = await polymarketAuth(wallet, { relayUrl });

    const allowances = await checkAllowances(auth.polygonAddress);
    console.log('Derived wallet:', auth.polygonAddress);
    console.log('All approved:', allowances.allApproved);
    for (const a of allowances.allowances) {
      console.log(`  ${a.name}: ${a.unlimited ? 'unlimited' : a.allowance.toFixed(2)}`);
    }
  });
});
