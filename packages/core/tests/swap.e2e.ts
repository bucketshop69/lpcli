/**
 * Swap E2E — real signing, real transaction.
 *
 * Swaps 0.16 SOL → USDC via Jupiter Ultra API.
 *   0.25 SOL total - 0.02 fee reserve - 0.07 pool reserve = 0.16 SOL
 *
 * Run with: pnpm --filter @lpcli/core test:e2e:swap
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  LPCLI,
  SOL_MINT,
  loadConfig,
  jupiterSwap,
} from '../src/index.js';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SWAP_LAMPORTS = 160_000_000; // 0.16 SOL

describe('Swap E2E (real signing)', { concurrency: false }, () => {

  // PASSED 2026-04-05 — 0.16 SOL → 12.67 USDC
  test.skip('swap 0.16 SOL → USDC', async () => {
    const config = loadConfig();
    const lpcli = new LPCLI();
    const wallet = await lpcli.getWallet();
    const address = wallet.getPublicKey().toBase58();

    // Pre-flight: check balance
    const balances = await wallet.getBalances();
    console.log(`\n  Wallet: ${address}`);
    console.log(`  SOL balance: ${balances.solBalance} (${balances.solLamports} lamports)`);
    console.log(`  Fee reserve: ${config.feeReserveSol} SOL`);
    console.log(`  Swapping: ${SWAP_LAMPORTS} lamports (${SWAP_LAMPORTS / 1e9} SOL) → USDC`);

    const minRequired = SWAP_LAMPORTS + (config.feeReserveSol * 1e9) + 70_000_000;
    assert.ok(
      balances.solLamports >= minRequired,
      `Need at least ${minRequired / 1e9} SOL, have ${balances.solBalance}`,
    );

    // Execute swap
    const result = await jupiterSwap(
      {
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        amount: SWAP_LAMPORTS,
      },
      wallet,
    );

    console.log(`\n  Swap result:`);
    console.log(`    signature: ${result.signature}`);
    console.log(`    type: ${result.swapType}`);
    console.log(`    in:  ${result.inAmount} lamports (${Number(result.inAmount) / 1e9} SOL)`);
    console.log(`    out: ${result.outAmount} (${Number(result.outAmount) / 1e6} USDC)`);
    console.log(`    impact: ${result.priceImpactPct}%`);
    if (result.inputAmountResult) {
      console.log(`    actual in:  ${result.inputAmountResult}`);
      console.log(`    actual out: ${result.outputAmountResult}`);
    }

    assert.ok(result.signature, 'should have a tx signature');
    assert.ok(Number(result.outAmount) > 0, 'should receive some USDC');

    // Post-flight: check new balances
    // Wait a moment for confirmation
    await new Promise(r => setTimeout(r, 2000));
    const after = await wallet.getBalances();
    const usdcAfter = after.tokens.find(t => t.mint === USDC_MINT);

    console.log(`\n  Post-swap balances:`);
    console.log(`    SOL: ${after.solBalance}`);
    console.log(`    USDC: ${usdcAfter?.uiAmount ?? 0}`);

    assert.ok(after.solLamports < balances.solLamports, 'SOL should decrease');
  });

});
