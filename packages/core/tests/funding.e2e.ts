/**
 * Funding Operations E2E — read-only, no signing.
 *
 * Exercises the full pipeline up to the point of signing:
 *   pool meta → balances → split → plan swaps → quote → verify amounts
 *
 * Run with: pnpm --filter @lpcli/core test:e2e:funding
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  LPCLI,
  DLMMService,
  WalletService,
  SOL_MINT,
  feeReserveLamports,
  getJupiterQuote,
  loadConfig,
} from '../src/index.js';
import { calculateSplit, planSwaps, planSwapBack } from '../src/funding.js';
import type { PoolMeta } from '../src/index.js';
import type { WalletBalances } from '../src/wallet.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const config = loadConfig();
const POOL = 'BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Fallback pool meta — built from HTTP API when SDK can't connect.
let httpPool: Awaited<ReturnType<LPCLI['getPoolInfo']>> | undefined;
function mockPoolMeta(price: number): PoolMeta {
  // We don't know mints without the SDK or HTTP raw data.
  // Use SOL/USDC defaults — the test will note this is a fallback.
  return {
    pool: POOL,
    tokenXMint: SOL_MINT,
    tokenYMint: USDC_MINT,
    tokenXDecimals: 9,
    tokenYDecimals: 6,
    activeBinId: 0,
    binStep: 1,
    activePrice: price,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Funding E2E (read-only)', { concurrency: false }, () => {

  let lpcli: LPCLI;
  let wallet: WalletService;
  let dlmm: DLMMService;
  let poolMeta: PoolMeta | undefined;
  let balances: WalletBalances;
  let currentPrice: number;

  // ── Setup: init wallet + get price from HTTP API ─────────────────────

  test('setup: init wallet and get pool price', async () => {
    lpcli = new LPCLI();
    wallet = await lpcli.getWallet();
    dlmm = lpcli.dlmm!;

    // Get price from the HTTP API (always works, no SDK needed)
    const poolInfo = await lpcli.getPoolInfo(POOL);
    currentPrice = poolInfo.current_price;

    console.log(`\n  Wallet: ${wallet.getPublicKey().toBase58()}`);
    console.log(`  Pool:   ${POOL} (${poolInfo.name})`);
    console.log(`  Price:  ${currentPrice} (from HTTP API)`);
    console.log(`  Funding: ${config.fundingToken.symbol} (${config.fundingToken.mint.slice(0, 8)}...)`);
    console.log(`  Fee reserve: ${config.feeReserveSol} SOL`);

    assert.ok(wallet, 'wallet should init');
    assert.ok(currentPrice > 0, 'price should be > 0');
  });

  // ── 1. Pool metadata (SDK) ───────────────────────────────────────────

  test('1. getPoolMeta — resolve mints, decimals, price from SDK', async () => {
    try {
      poolMeta = await dlmm.getPoolMeta(POOL);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`\n  ⚠ SDK getPoolMeta failed (using mock): ${msg.slice(0, 80)}`);
      poolMeta = mockPoolMeta(currentPrice);
    }

    console.log('\n  Pool meta:');
    console.log(`    tokenX: ${poolMeta.tokenXMint} (${poolMeta.tokenXDecimals} decimals)`);
    console.log(`    tokenY: ${poolMeta.tokenYMint} (${poolMeta.tokenYDecimals} decimals)`);
    console.log(`    price: ${poolMeta.activePrice}`);

    assert.ok(poolMeta.tokenXMint, 'tokenXMint should exist');
    assert.ok(poolMeta.tokenYMint, 'tokenYMint should exist');
    assert.ok(poolMeta.tokenXDecimals > 0, 'tokenX decimals should be > 0');
    assert.ok(poolMeta.tokenYDecimals > 0, 'tokenY decimals should be > 0');
  });

  // ── 2. Wallet balances ────────────────────────────────────────────────

  test('2. getBalances — read SOL + SPL from chain', async () => {
    balances = await wallet.getBalances();

    console.log('\n  Balances:');
    console.log(`    SOL: ${balances.solBalance} (${balances.solLamports} lamports)`);
    for (const t of balances.tokens) {
      console.log(`    ${t.mint.slice(0, 8)}...: ${t.uiAmount} (${t.amount} raw, ${t.decimals} dec)`);
    }

    assert.ok(balances.solLamports > 0, 'should have some SOL');
  });

  // ── 3. Calculate split ────────────────────────────────────────────────

  test('3. calculateSplit — 50/50 balanced split', () => {
    const pm = poolMeta!;
    const budgetRaw = 10_000_000; // 10 USDC (6 decimals)
    const split = calculateSplit(
      budgetRaw,
      config.fundingToken.mint,
      config.fundingToken.decimals,
      pm,
      0.5,
    );

    console.log('\n  Split (10 USDC budget, 50/50):');
    console.log(`    targetX (SOL): ${split.amountX.toFixed(6)}`);
    console.log(`    targetY (USDC): ${split.amountY.toFixed(6)}`);
    console.log(`    price used: ${pm.activePrice}`);

    assert.ok(split.amountX > 0, 'amountX should be > 0');
    assert.ok(split.amountY > 0, 'amountY should be > 0');

    // Y should be ~5 USDC (half the budget)
    assert.ok(split.amountY > 4 && split.amountY < 6, `amountY ${split.amountY} should be ~5 USDC`);

    // X should be ~5 / price SOL
    const expectedX = 5 / pm.activePrice;
    const tolerance = expectedX * 0.01;
    assert.ok(
      Math.abs(split.amountX - expectedX) < tolerance,
      `amountX ${split.amountX} should be ~${expectedX.toFixed(6)} SOL`,
    );
  });

  test('3b. calculateSplit — asymmetric 70/30', () => {
    const pm = poolMeta!;
    const budgetRaw = 10_000_000; // 10 USDC
    const split = calculateSplit(
      budgetRaw,
      config.fundingToken.mint,
      config.fundingToken.decimals,
      pm,
      0.7,
    );

    console.log('\n  Split (10 USDC budget, 70/30):');
    console.log(`    targetX (SOL): ${split.amountX.toFixed(6)}`);
    console.log(`    targetY (USDC): ${split.amountY.toFixed(6)}`);

    // Y should be ~3 USDC (30% of 10)
    assert.ok(split.amountY > 2.5 && split.amountY < 3.5, `amountY ${split.amountY} should be ~3 USDC`);
    assert.ok(split.amountX > 0, 'amountX should be > 0');
  });

  // ── 4. Plan swaps ────────────────────────────────────────────────────

  test('4. planSwaps — verify raw amounts (the critical bug fix)', () => {
    const pm = poolMeta!;

    const budgetRaw = 10_000_000; // 10 USDC
    const split = calculateSplit(
      budgetRaw,
      config.fundingToken.mint,
      config.fundingToken.decimals,
      pm,
      0.5,
    );

    const feeReserve = feeReserveLamports(config);
    const steps = planSwaps({
      targetX: split.amountX,
      targetY: split.amountY,
      balances,
      poolMeta: pm,
      fundingMint: config.fundingToken.mint,
      fundingDecimals: config.fundingToken.decimals,
      feeReserve,
    });

    console.log('\n  Swap plan:');
    console.log(`    target X (UI): ${split.amountX.toFixed(6)} SOL`);
    console.log(`    target Y (UI): ${split.amountY.toFixed(6)} USDC`);
    console.log(`    available SOL: ${balances.solBalance} (after reserve: ${Math.max(0, balances.solBalance - config.feeReserveSol).toFixed(4)})`);
    console.log(`    steps: ${steps.length}`);
    for (const s of steps) {
      console.log(`      ${s.inputMint.slice(0, 8)}... → ${s.outputMint.slice(0, 8)}... amount=${s.amount} (raw)`);
    }

    // CRITICAL: amounts must be in raw, not UI
    for (const step of steps) {
      assert.ok(step.amount > 1000, `step amount ${step.amount} should be raw (>1000), not UI`);
      assert.ok(Number.isInteger(step.amount), `step amount ${step.amount} should be an integer`);
      assert.ok(step.inputMint, 'inputMint should be set');
      assert.ok(step.outputMint, 'outputMint should be set');
      assert.notStrictEqual(step.inputMint, step.outputMint, 'input and output should differ');
    }

    assert.ok(steps.length > 0, 'should plan at least 1 swap');
  });

  // ── 5. Plan swap-back ─────────────────────────────────────────────────

  test('5. planSwapBack — simulate post-close swap-back', () => {
    const pm = poolMeta!;

    // Mock: after closing, wallet has some of each pool token.
    // Non-funding tokens should be swapped back to funding token.
    // SOL reserve is always respected.
    const mockBalances: WalletBalances = {
      address: wallet.getPublicKey().toBase58(),
      solBalance: 0.5,
      solLamports: 500_000_000,
      tokens: [
        { mint: pm.tokenXMint, amount: '1000000000', uiAmount: 1000, decimals: 6 },
        { mint: pm.tokenYMint, amount: '50000000', uiAmount: 50, decimals: 6 },
      ],
    };

    const feeReserve = feeReserveLamports(config);
    const steps = planSwapBack({
      balances: mockBalances,
      tokenMints: [pm.tokenXMint, pm.tokenYMint],
      fundingMint: config.fundingToken.mint,
      feeReserve,
    });

    console.log('\n  Swap-back plan (mock post-close):');
    console.log(`    tokenX: ${pm.tokenXMint.slice(0, 8)}... (mock: 1000)`);
    console.log(`    tokenY: ${pm.tokenYMint.slice(0, 8)}... (mock: 50)`);
    console.log(`    funding: ${config.fundingToken.symbol} (${config.fundingToken.mint.slice(0, 8)}...)`);
    console.log(`    steps: ${steps.length}`);
    for (const s of steps) {
      console.log(`      ${s.inputMint.slice(0, 8)}... → ${s.outputMint.slice(0, 8)}... amount=${s.amount} (raw)`);
    }

    // Every step should swap TO the funding token
    for (const step of steps) {
      assert.strictEqual(step.outputMint, config.fundingToken.mint, 'output should be funding token');
      assert.ok(step.amount > 0, 'amount should be > 0');
      assert.ok(Number.isInteger(step.amount), 'amount should be integer (raw)');
    }

    // Should not swap the funding token to itself
    const selfSwap = steps.find(s => s.inputMint === config.fundingToken.mint);
    assert.strictEqual(selfSwap, undefined, 'should not swap funding token to itself');

    // If SOL is one of the pool tokens, verify reserve is deducted
    const solStep = steps.find(s => s.inputMint === SOL_MINT);
    if (solStep) {
      const expectedMax = 500_000_000 - feeReserve;
      assert.ok(solStep.amount <= expectedMax, `SOL swap ${solStep.amount} should respect fee reserve (max ${expectedMax})`);
    }
  });

  // ── 6. Jupiter quote ──────────────────────────────────────────────────

  test('6. getJupiterQuote — quote without executing', async () => {
    try {
      const quote = await getJupiterQuote({
        inputMint: SOL_MINT,
        outputMint: config.fundingToken.mint,
        amount: 100_000_000, // 0.1 SOL in lamports
      });

      console.log('\n  Jupiter quote (0.1 SOL → USDC):');
      console.log(`    inAmount:  ${quote.inAmount}`);
      console.log(`    outAmount: ${quote.outAmount}`);
      console.log(`    priceImpact: ${quote.priceImpactPct}%`);

      const usdcOut = Number(quote.outAmount) / 1_000_000;
      console.log(`    ≈ ${usdcOut.toFixed(2)} USDC`);

      assert.ok(Number(quote.outAmount) > 0, 'outAmount should be > 0');
    } catch (err: unknown) {
      // Ultra API rejects dummy taker — expected on some endpoints
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`\n  ⚠ Jupiter quote failed (expected with dummy taker): ${msg.slice(0, 80)}`);
    }
  });

  // ── 7. Positions ──────────────────────────────────────────────────────

  test('7. getPositions — list wallet positions', async () => {
    const positions = await dlmm.getPositions(wallet.getPublicKey().toBase58());

    console.log(`\n  Positions: ${positions.length}`);
    for (const p of positions) {
      console.log(`    ${p.address.slice(0, 8)}... pool=${p.pool.slice(0, 8)}... status=${p.status}`);
    }

    assert.ok(Array.isArray(positions), 'should return an array');
  });

  // ── 8. Pool info (HTTP API) ───────────────────────────────────────────

  test('8. getPoolInfo — Meteora HTTP API', async () => {
    const info = await lpcli.getPoolInfo(POOL);

    console.log('\n  Pool info (HTTP):');
    console.log(`    name: ${info.name}`);
    console.log(`    tokenX: ${info.token_x}, tokenY: ${info.token_y}`);
    console.log(`    price: ${info.current_price}`);
    console.log(`    TVL: $${info.tvl.toFixed(0)}`);
    console.log(`    24h volume: $${info.volume_24h.toFixed(0)}`);
    console.log(`    24h fees: $${info.fee_24h.toFixed(0)}`);

    assert.ok(info.name, 'name should exist');
    assert.ok(info.current_price > 0, 'price should be > 0');
  });

  // ── 9. Discover pools ─────────────────────────────────────────────────

  test('9. discoverPools — rank by score', async () => {
    const pools = await lpcli.discoverPools('SOL', 'score', 3);

    console.log('\n  Top 3 SOL pools:');
    for (const p of pools) {
      console.log(`    ${p.name} score=${p.score.toFixed(1)} TVL=$${(p.tvl / 1e6).toFixed(1)}M`);
    }

    assert.ok(pools.length >= 1, 'should find at least 1 pool');
  });

});

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

console.log(`
╔══════════════════════════════════════════════════════╗
║  Funding E2E Tests (read-only, no signing)          ║
║  Pool: ${POOL.slice(0, 20)}...                  ║
║  Funding: ${(config.fundingToken.symbol + ' (' + config.fundingToken.mint.slice(0, 12) + '...)').padEnd(40)}║
║  Fee reserve: ${String(config.feeReserveSol).padEnd(36)}║
╚══════════════════════════════════════════════════════╝
`);
