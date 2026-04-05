/**
 * Open Position E2E — real signing, real transactions.
 *
 * Pool: BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y (SOL-USDC, bin step 10)
 *
 * Uses fundedOpen: budget → split → swap → open position.
 *
 * Run with: pnpm --filter @lpcli/core test:e2e:open
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  LPCLI,
  loadConfig,
} from '../src/index.js';
import { fundedOpen } from '../src/funding.js';

const POOL = 'BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

describe('Open Position E2E (real signing)', { concurrency: false }, () => {

  // PASSED 2026-04-05 — 10.6 USDC → 0.067 SOL + 5.3 USDC position on SOL-USDC
  // position: 51iGNZGUaQZEfhSa7sMxJxZoPGLrxx1QGMS2gzvopyaD
  // tx: 5E1xH32x6FoqxS8pjT45ocWpkBRHHGgTKq4yszTZKyjQgap9QF5aUp9yCp5d59FowLC7Xj873LGRamnGQqfWYgxt
  test.skip('fundedOpen: USDC → 50/50 SOL-USDC position', async () => {
    const config = loadConfig();
    const lpcli = new LPCLI();
    const wallet = await lpcli.getWallet();
    const dlmm = lpcli.dlmm!;
    const address = wallet.getPublicKey().toBase58();

    // Pre-flight
    const balances = await wallet.getBalances();
    console.log(`\n  Wallet: ${address}`);
    console.log(`  Pool:   ${POOL}`);
    console.log(`  SOL:    ${balances.solBalance}`);
    const usdcBal = balances.tokens.find(t => t.mint === USDC_MINT);
    console.log(`  USDC:   ${usdcBal?.uiAmount ?? 0}`);

    const usdcRaw = Number(usdcBal?.amount ?? 0);
    assert.ok(usdcRaw > 0, 'Need USDC to open position');
    // Use 80% of available USDC — leave some buffer
    const budgetRaw = Math.floor(usdcRaw * 0.8);
    console.log(`  Budget: ${budgetRaw / 1e6} USDC (80% of ${usdcRaw / 1e6})`);

    // fundedOpen handles: split → swap → open
    console.log(`\n  Running fundedOpen...`);
    const result = await fundedOpen({
      pool: POOL,
      amount: budgetRaw,
      config,
      wallet,
      dlmm,
      ratioX: 0.5,
      strategy: 'spot',
    });

    console.log(`\n  Position opened!`);
    console.log(`    address:  ${result.position.position}`);
    console.log(`    tx:       ${result.position.tx}`);
    console.log(`    range:    ${result.position.range_low.toFixed(4)} — ${result.position.range_high.toFixed(4)}`);
    console.log(`    swaps:    ${result.swaps.length}`);
    for (const s of result.swaps) {
      console.log(`      ${s.inAmount} → ${s.outAmount} (sig: ${s.signature.slice(0, 16)}...)`);
    }

    assert.ok(result.position.position, 'should have position address');
    assert.ok(result.position.tx, 'should have tx signature');

    // Post-flight
    await new Promise(r => setTimeout(r, 2000));
    const after = await wallet.getBalances();
    console.log(`\n  Post-open balances:`);
    console.log(`    SOL:  ${after.solBalance}`);
    const usdcAfter = after.tokens.find(t => t.mint === USDC_MINT);
    console.log(`    USDC: ${usdcAfter?.uiAmount ?? 0}`);
  });

});
