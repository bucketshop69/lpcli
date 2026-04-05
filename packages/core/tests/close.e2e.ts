/**
 * Close Position E2E — real signing, real transactions.
 *
 * Finds the first open position on the wallet, closes it,
 * and swaps all proceeds back to the funding token.
 *
 * Run with: pnpm --filter @lpcli/core test:e2e:close
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  LPCLI,
  loadConfig,
  feeReserveLamports,
} from '../src/index.js';
import { planSwapBack, executeSwaps } from '../src/funding.js';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

describe('Close Position E2E (real signing)', { concurrency: false }, () => {

  test('close first position + swap-back to funding token', async () => {
    const config = loadConfig();
    const lpcli = new LPCLI();
    const wallet = await lpcli.getWallet();
    const dlmm = lpcli.dlmm!;
    const address = wallet.getPublicKey().toBase58();

    // 1. Pre-close balances
    const preBal = await wallet.getBalances();
    console.log(`\n  Wallet: ${address}`);
    console.log(`  Pre-close balances:`);
    console.log(`    SOL:  ${preBal.solBalance}`);
    const usdcPre = preBal.tokens.find(t => t.mint === USDC_MINT);
    console.log(`    USDC: ${usdcPre?.uiAmount ?? 0}`);

    // 2. Find first position
    const positions = await dlmm.getPositions(address);
    assert.ok(positions.length > 0, 'Need at least one open position');

    const pos = positions[0];
    console.log(`\n  Closing position: ${pos.address}`);
    console.log(`    pool:   ${pos.pool}`);
    console.log(`    status: ${pos.status}`);
    console.log(`    value X: ${pos.current_value_x}`);
    console.log(`    value Y: ${pos.current_value_y}`);

    // 3. Close position
    console.log(`\n  Closing...`);
    const closeResult = await dlmm.closePosition(pos.address);
    console.log(`    tx: ${closeResult.tx}`);
    console.log(`    withdrawn X: ${closeResult.withdrawn_x}`);
    console.log(`    withdrawn Y: ${closeResult.withdrawn_y}`);
    console.log(`    fees X: ${closeResult.claimed_fees_x}`);
    console.log(`    fees Y: ${closeResult.claimed_fees_y}`);

    assert.ok(closeResult.tx, 'should have tx signature');

    // 4. Post-close balances
    await new Promise(r => setTimeout(r, 2000));
    const postBal = await wallet.getBalances();
    console.log(`\n  Post-close balances:`);
    console.log(`    SOL:  ${postBal.solBalance} (${postBal.solLamports} lamports)`);
    const usdcPost = postBal.tokens.find(t => t.mint === USDC_MINT);
    console.log(`    USDC: ${usdcPost?.uiAmount ?? 0}`);

    // 5. Pool meta for swap-back
    const poolMeta = await dlmm.getPoolMeta(pos.pool);

    // 6. Plan swap-back
    const feeReserve = feeReserveLamports(config);
    const steps = planSwapBack({
      balances: postBal,
      tokenMints: [poolMeta.tokenXMint, poolMeta.tokenYMint],
      fundingMint: config.fundingToken.mint,
      feeReserve,
    });

    console.log(`\n  Swap-back steps: ${steps.length}`);
    for (const s of steps) {
      console.log(`    ${s.inputMint.slice(0, 8)}... → ${s.outputMint.slice(0, 8)}... amount=${s.amount}`);
    }

    // 7. Execute swap-back
    if (steps.length > 0) {
      console.log(`\n  Executing swap-back...`);
      const swapResults = await executeSwaps(steps, wallet);
      for (const r of swapResults) {
        console.log(`    sig: ${r.signature}`);
        console.log(`    in: ${r.inAmount} → out: ${r.outAmount}`);
      }
    } else {
      console.log(`\n  No swap-back needed`);
    }

    // 8. Final balances
    await new Promise(r => setTimeout(r, 2000));
    const finalBal = await wallet.getBalances();
    const usdcFinal = finalBal.tokens.find(t => t.mint === USDC_MINT);
    console.log(`\n  Final balances:`);
    console.log(`    SOL:  ${finalBal.solBalance}`);
    console.log(`    USDC: ${usdcFinal?.uiAmount ?? 0}`);
  });

});
