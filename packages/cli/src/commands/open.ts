/**
 * `lpcli open <pool>` — open a new liquidity position with auto-swap.
 *
 * Usage:
 *   lpcli open <pool_address> --amount 200
 *     Opens a balanced (50/50) position. --amount is in funding token units
 *     (e.g. 200 = 200 USDC if funding token is USDC).
 *     Automatically swaps funding token into both pool tokens as needed.
 *
 *   lpcli open <pool_address> --amount 200 --ratio 0.7
 *     70% token X, 30% token Y (for asymmetric strategies).
 *
 *   lpcli open <pool_address> --amount 200 --strategy bidask --bins 20
 *
 * The --amount flag uses the funding token from config.json.
 * For raw control, use --amount-x and --amount-y (in lamports/raw units)
 * to skip the auto-swap and deposit exact amounts.
 */

import { LPCLI } from '@lpcli/core';
import type { FundedOpenResult, OpenPositionResult } from '@lpcli/core';
import { getFlag, createRL, ask, solscanTxUrl } from '../helpers.js';

// ---------------------------------------------------------------------------
// Command entrypoint
// ---------------------------------------------------------------------------

export async function runOpen(args: string[]): Promise<void> {
  const pool = args[0];
  if (!pool) {
    console.error('Usage: lpcli open <pool_address> --amount <funding_token_amount> [--ratio 0.5] [--strategy spot|bidask|curve] [--bins N]');
    console.error('       lpcli open <pool_address> --amount-x <raw> --amount-y <raw>  (skip auto-swap)');
    process.exit(1);
  }

  const amountRaw   = getFlag(args, '--amount');
  const amountXRaw  = getFlag(args, '--amount-x');
  const amountYRaw  = getFlag(args, '--amount-y');
  const ratioRaw    = getFlag(args, '--ratio');
  const strategyRaw = getFlag(args, '--strategy') ?? 'spot';
  const binsRaw     = getFlag(args, '--bins');

  const validStrategies = ['spot', 'bidask', 'curve'] as const;
  type Strategy = typeof validStrategies[number];
  if (!validStrategies.includes(strategyRaw as Strategy)) {
    console.error(`--strategy must be one of: ${validStrategies.join(', ')}`);
    process.exit(1);
  }
  const strategy = strategyRaw as Strategy;
  const widthBins = binsRaw ? parseInt(binsRaw, 10) : undefined;

  const lpcli = new LPCLI();
  let wallet;
  try {
    wallet = await lpcli.getWallet();
  } catch (err: unknown) {
    console.error('Wallet error:', err instanceof Error ? err.message : String(err));
    console.error('Run `lpcli init` to set up your wallet.');
    process.exit(1);
  }

  // ── Funded mode: --amount (auto-swap) ──────────────────────────────────

  if (amountRaw !== undefined) {
    const funding = lpcli.getFundingToken();
    const amountUi = parseFloat(amountRaw);
    if (isNaN(amountUi) || amountUi <= 0) {
      console.error('--amount must be a positive number');
      process.exit(1);
    }

    const ratioX = ratioRaw !== undefined ? parseFloat(ratioRaw) : 0.5;
    if (isNaN(ratioX) || ratioX < 0 || ratioX > 1) {
      console.error('--ratio must be between 0.0 and 1.0');
      process.exit(1);
    }

    // Convert UI amount to smallest unit for the funding module.
    const amountSmallest = Math.floor(amountUi * 10 ** funding.decimals);

    // Resolve pool info for the confirmation prompt.
    const dlmm = lpcli.dlmm!;
    const poolMeta = await dlmm.getPoolMeta(pool);
    const balances = await wallet.getBalances();

    // Resolve token symbols from cache
    const symX = (lpcli.tokenRegistry.getCached(poolMeta.tokenXMint)?.symbol ?? poolMeta.tokenXMint.slice(0, 6)).toUpperCase();
    const symY = (lpcli.tokenRegistry.getCached(poolMeta.tokenYMint)?.symbol ?? poolMeta.tokenYMint.slice(0, 6)).toUpperCase();

    const rl = createRL();
    console.log(`
Open position on pool ${pool}:
  Funding token:  ${funding.symbol}
  Budget:         ${amountUi} ${funding.symbol}
  Split ratio:    ${(ratioX * 100).toFixed(0)}% ${symX} / ${((1 - ratioX) * 100).toFixed(0)}% ${symY}
  Strategy:       ${strategy}
  Bin width:      ${widthBins !== undefined ? String(widthBins) : 'auto'}
  Pool:           ${symX}-${symY}
  Active price:   ${poolMeta.activePrice.toFixed(6)} ${symY} per ${symX}
  SOL balance:    ${balances.solBalance.toFixed(4)} SOL (${lpcli.config.feeReserveSol} SOL reserved for fees)
`);

    const confirm = await ask(rl, 'Confirm? [y/N] ');
    rl.close();

    if (confirm.toLowerCase() !== 'y') {
      console.log('Aborted.');
      process.exit(0);
    }

    console.log('\nSwapping & opening position...');

    let result: FundedOpenResult;
    try {
      result = await lpcli.openWithFunding({
        pool,
        amount: amountSmallest,
        ratioX,
        strategy,
        widthBins,
      });
    } catch (err: unknown) {
      console.error('Failed:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    console.log(`
Position opened successfully!

  Position:    ${result.position.position}
  Range:       ${result.position.range_low.toFixed(6)} — ${result.position.range_high.toFixed(6)}
  Deposited:   ${result.position.deposited_x_ui.toFixed(4)} ${result.position.token_x_symbol}  +  ${result.position.deposited_y_ui.toFixed(4)} ${result.position.token_y_symbol}
  TX:          ${solscanTxUrl(result.position.tx)}
  Swaps:       ${result.swaps.length} swap(s) executed
`);
    return;
  }

  // ── Raw mode: --amount-x / --amount-y (no auto-swap) ───────────────────

  let amountX: number | undefined;
  let amountY: number | undefined;

  if (amountXRaw !== undefined) amountX = parseFloat(amountXRaw);
  if (amountYRaw !== undefined) amountY = parseFloat(amountYRaw);

  if (amountX === undefined && amountY === undefined) {
    console.error('Provide --amount (funded mode) or --amount-x / --amount-y (raw mode)');
    process.exit(1);
  }

  const dlmm = lpcli.dlmm!;

  const rl = createRL();
  console.log(`
Open position on pool ${pool} (raw mode):
  Strategy:  ${strategy}
  Amount X:  ${amountX !== undefined ? amountX : '—'} (raw)
  Amount Y:  ${amountY !== undefined ? amountY : '—'} (raw)
  Bin width: ${widthBins !== undefined ? String(widthBins) : 'auto'}
`);

  const confirm = await ask(rl, 'Confirm? [y/N] ');
  rl.close();

  if (confirm.toLowerCase() !== 'y') {
    console.log('Aborted.');
    process.exit(0);
  }

  console.log('\nOpening position...');

  let result: OpenPositionResult;
  try {
    result = await dlmm.openPosition({
      pool,
      amountX,
      amountY,
      strategy,
      widthBins,
    });
  } catch (err: unknown) {
    console.error('Failed to open position:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  console.log(`
Position opened successfully!

  Position:    ${result.position}
  Range:       ${result.range_low.toFixed(6)} — ${result.range_high.toFixed(6)}
  Deposited:   ${result.deposited_x_ui.toFixed(4)} ${result.token_x_symbol}  +  ${result.deposited_y_ui.toFixed(4)} ${result.token_y_symbol}
  TX:          ${solscanTxUrl(result.tx)}
`);
}
