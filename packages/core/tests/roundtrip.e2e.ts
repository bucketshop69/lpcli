/**
 * Round-trip E2E — open → wait → close on a non-USDC pool.
 *
 * Tests the full funded lifecycle where neither pool token is the funding token.
 * Pool: 81GpCm4d13y8TozYtThabuSCLQN2o3bbrvDogXFPn8sA (HYPE-SOL)
 *
 * Run with: pnpm --filter @lpcli/core test:e2e:roundtrip
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { LPCLI, loadConfig } from '../src/index.js';
import { fundedOpen, fundedClose } from '../src/funding.js';

const POOL = '81GpCm4d13y8TozYtThabuSCLQN2o3bbrvDogXFPn8sA';

describe('Round-trip E2E: open → wait → close (HYPE-SOL)', { concurrency: false }, () => {

  test('full lifecycle', async () => {
    const config = loadConfig();
    const lpcli = new LPCLI();
    const wallet = await lpcli.getWallet();
    const dlmm = lpcli.dlmm!;
    const address = wallet.getPublicKey().toBase58();

    // Pre-flight
    const before = await wallet.getBalances();
    const fundingBal = before.tokens.find(t => t.mint === config.fundingToken.mint);
    console.log(`\n  Wallet:  ${address}`);
    console.log(`  Pool:    ${POOL}`);
    console.log(`  Funding: ${config.fundingToken.symbol}`);
    console.log(`  SOL:     ${before.solBalance}`);
    console.log(`  ${config.fundingToken.symbol}:    ${fundingBal?.uiAmount ?? 0}`);

    const budgetRaw = 10 * 10 ** config.fundingToken.decimals; // $10 in raw
    assert.ok(
      (fundingBal?.uiAmount ?? 0) >= 10,
      `Need at least 10 ${config.fundingToken.symbol}`,
    );

    // ── OPEN ──────────────────────────────────────────────────────────
    console.log(`\n  Opening with ${budgetRaw / 10 ** config.fundingToken.decimals} ${config.fundingToken.symbol}...`);
    const openResult = await fundedOpen({
      pool: POOL,
      amount: budgetRaw,
      config,
      wallet,
      dlmm,
      ratioX: 0.5,
      strategy: 'spot',
    });

    const posAddress = openResult.position.position;
    console.log(`\n  Position opened!`);
    console.log(`    address: ${posAddress}`);
    console.log(`    tx:      ${openResult.position.tx}`);
    console.log(`    range:   ${openResult.position.range_low.toFixed(6)} — ${openResult.position.range_high.toFixed(6)}`);
    console.log(`    swaps:   ${openResult.swaps.length}`);
    for (const s of openResult.swaps) {
      console.log(`      in: ${s.inAmount} → out: ${s.outAmount}`);
    }

    assert.ok(posAddress, 'should have position address');
    assert.ok(openResult.position.tx, 'should have open tx');

    // ── WAIT ──────────────────────────────────────────────────────────
    console.log(`\n  Waiting 60s for fees to accrue...`);
    await new Promise(r => setTimeout(r, 60_000));

    // ── CLOSE ─────────────────────────────────────────────────────────
    console.log(`  Closing position...`);
    const closeResult = await fundedClose({
      positionAddress: posAddress,
      pool: POOL,
      config,
      wallet,
      dlmm,
    });

    console.log(`\n  Position closed!`);
    console.log(`    tx:          ${closeResult.close.tx}`);
    console.log(`    withdrawn X: ${closeResult.close.withdrawn_x}`);
    console.log(`    withdrawn Y: ${closeResult.close.withdrawn_y}`);
    console.log(`    fees X:      ${closeResult.close.claimed_fees_x}`);
    console.log(`    fees Y:      ${closeResult.close.claimed_fees_y}`);
    console.log(`    swap-backs:  ${closeResult.swaps.length}`);
    for (const s of closeResult.swaps) {
      console.log(`      in: ${s.inAmount} → out: ${s.outAmount} (sig: ${s.signature.slice(0, 16)}...)`);
    }

    // ── FINAL ─────────────────────────────────────────────────────────
    await new Promise(r => setTimeout(r, 2000));
    const after = await wallet.getBalances();
    const fundingAfter = after.tokens.find(t => t.mint === config.fundingToken.mint);
    console.log(`\n  Final balances:`);
    console.log(`    SOL:  ${after.solBalance}`);
    console.log(`    ${config.fundingToken.symbol}:  ${fundingAfter?.uiAmount ?? 0}`);

    const startUsdc = fundingBal?.uiAmount ?? 0;
    const endUsdc = fundingAfter?.uiAmount ?? 0;
    const pnl = endUsdc - startUsdc + 10; // started with 10 less
    console.log(`\n  Round-trip PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} ${config.fundingToken.symbol}`);
  });

});
