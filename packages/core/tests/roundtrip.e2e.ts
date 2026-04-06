/**
 * Round-trip E2E — open → wait → close.
 *
 * Usage:
 *   POOL=<address> AMOUNT=<ui_amount> pnpm --filter @lpcli/core test:e2e:roundtrip
 *
 * Environment:
 *   POOL     — pool address (required)
 *   AMOUNT   — budget in funding token UI units, e.g. "10" for $10 USDC (required)
 *   WAIT_SEC — seconds to wait between open and close (default: 60)
 *
 * Everything else is derived from config + on-chain state.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { LPCLI, loadConfig } from '../src/index.js';
import { fundedOpen, fundedClose } from '../src/funding.js';

const POOL = process.env['POOL'];
const AMOUNT_UI = process.env['AMOUNT'];
const WAIT_SEC = parseInt(process.env['WAIT_SEC'] ?? '60', 10);

if (!POOL || !AMOUNT_UI) {
  console.error('\n  Missing required env vars: POOL and AMOUNT');
  console.error('  Usage: POOL=<address> AMOUNT=10 pnpm --filter @lpcli/core test:e2e:roundtrip\n');
  process.exit(1);
}

describe(`Round-trip E2E: open → wait ${WAIT_SEC}s → close`, { concurrency: false }, () => {

  test('full lifecycle', async () => {
    const config = loadConfig();
    const lpcli = new LPCLI();
    const wallet = await lpcli.getWallet();
    const dlmm = lpcli.dlmm!;
    const address = wallet.getPublicKey().toBase58();

    const amountUi = parseFloat(AMOUNT_UI!);
    const budgetRaw = Math.floor(amountUi * 10 ** config.fundingToken.decimals);

    // Pre-flight — targeted lookup, not full token scan
    const before = await wallet.getMintBalances([config.fundingToken.mint]);
    const fundingBal = before.tokens.find(t => t.mint === config.fundingToken.mint);
    const fundingAvailable = fundingBal?.uiAmount ?? 0;

    console.log(`\n  Wallet:     ${address}`);
    console.log(`  Pool:       ${POOL}`);
    console.log(`  Funding:    ${config.fundingToken.symbol}`);
    console.log(`  Budget:     ${amountUi} ${config.fundingToken.symbol} (${budgetRaw} raw)`);
    console.log(`  SOL:        ${before.solBalance}`);
    console.log(`  ${config.fundingToken.symbol}:       ${fundingAvailable}`);

    assert.ok(
      fundingAvailable >= amountUi,
      `Need at least ${amountUi} ${config.fundingToken.symbol}, have ${fundingAvailable}`,
    );

    // ── OPEN ──────────────────────────────────────────────────────────
    console.log(`\n  Opening with ${amountUi} ${config.fundingToken.symbol}...`);
    const openResult = await fundedOpen({
      pool: POOL!,
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
    console.log(`\n  Waiting ${WAIT_SEC}s...`);
    await new Promise(r => setTimeout(r, WAIT_SEC * 1000));

    // ── CLOSE ─────────────────────────────────────────────────────────
    console.log(`  Closing position...`);
    const closeResult = await fundedClose({
      positionAddress: posAddress,
      pool: POOL!,
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
    const after = await wallet.getMintBalances([config.fundingToken.mint]);
    const fundingAfter = after.tokens.find(t => t.mint === config.fundingToken.mint);
    const endAmount = fundingAfter?.uiAmount ?? 0;

    console.log(`\n  Final balances:`);
    console.log(`    SOL:  ${after.solBalance}`);
    console.log(`    ${config.fundingToken.symbol}:  ${endAmount}`);

    const pnl = endAmount - (fundingAvailable - amountUi) - amountUi;
    console.log(`\n  Round-trip PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} ${config.fundingToken.symbol}`);
  });

});
