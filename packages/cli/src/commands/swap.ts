/**
 * `lpcli swap` — swap tokens via Jupiter Ultra API.
 *
 * Interactive mode (no flags):
 *   lpcli swap
 *     Shows available tokens, user picks from/to with arrow keys,
 *     chooses amount, confirms, executes.
 *
 * Script mode (flags):
 *   lpcli swap --from <mint|SOL|USDC> --to <mint|SOL|USDC> --amount <raw>
 *   lpcli swap --from <mint|SOL|USDC> --to <mint|SOL|USDC> --all
 */

import * as p from '@clack/prompts';
import {
  LPCLI,
  SOL_MINT,
  USDC_MINT,
  LAMPORTS_PER_SOL,
  jupiterSwap,
  TokenRegistry,
  loadConfig,
  feeReserveLamports,
} from '@lpcli/core';
import type { WalletService, WalletBalances } from '@lpcli/core';

import { getFlag, hasFlag, solscanTxUrl } from '../helpers.js';

function resolveMint(input: string): string {
  const upper = input.toUpperCase();
  if (upper === 'SOL') return SOL_MINT;
  if (upper === 'USDC') return USDC_MINT;
  return input;
}

interface DisplayToken {
  mint: string;
  symbol: string;
  uiAmount: number;
  rawAmount: number;
  decimals: number;
}

/**
 * Build a list of tokens the wallet holds (SOL + SPL), enriched with symbols.
 */
async function getDisplayTokens(
  balances: WalletBalances,
  registry: TokenRegistry,
): Promise<DisplayToken[]> {
  const mints = [SOL_MINT, ...balances.tokens.map((t) => t.mint)];
  const meta = await registry.resolve(mints);

  const tokens: DisplayToken[] = [];

  // SOL first
  const solMeta = meta.get(SOL_MINT);
  tokens.push({
    mint: SOL_MINT,
    symbol: solMeta?.symbol ?? 'SOL',
    uiAmount: balances.solBalance,
    rawAmount: balances.solLamports,
    decimals: 9,
  });

  // SPL tokens
  for (const t of balances.tokens) {
    const m = meta.get(t.mint);
    tokens.push({
      mint: t.mint,
      symbol: m?.symbol ?? t.mint.slice(0, 6),
      uiAmount: t.uiAmount,
      rawAmount: Number(t.amount),
      decimals: t.decimals,
    });
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Interactive mode
// ---------------------------------------------------------------------------

async function runInteractive(wallet: WalletService): Promise<void> {
  const config = loadConfig();
  const feeReserve = feeReserveLamports(config);

  p.intro('lpcli swap');

  const s = p.spinner();
  s.start('Fetching balances & token info...');

  const balances = await wallet.getBalances();
  const registry = new TokenRegistry(wallet.getConnection());
  const tokens = await getDisplayTokens(balances, registry);

  s.stop('Wallet loaded.');

  // Pick "from" token
  const fromMint = await p.select({
    message: 'Swap from',
    options: tokens.map((t) => ({
      value: t.mint,
      label: `${t.symbol.padEnd(10)} ${t.uiAmount}`,
    })),
  });

  if (p.isCancel(fromMint)) {
    p.cancel('Aborted.');
    process.exit(0);
  }

  // Pick "to" token — filter out the "from" token, add common targets if not in wallet
  const toOptions = tokens
    .filter((t) => t.mint !== fromMint)
    .map((t) => ({
      value: t.mint,
      label: `${t.symbol.padEnd(10)} ${t.uiAmount}`,
    }));

  // Add USDC and SOL as targets even if not in wallet
  const existingMints = new Set(toOptions.map((o) => o.value));
  if (!existingMints.has(USDC_MINT) && fromMint !== USDC_MINT) {
    toOptions.push({ value: USDC_MINT, label: 'USDC       (not in wallet)' });
  }
  if (!existingMints.has(SOL_MINT) && fromMint !== SOL_MINT) {
    toOptions.push({ value: SOL_MINT, label: 'SOL        (not in wallet)' });
  }

  const toMint = await p.select({
    message: 'Swap to',
    options: toOptions,
  });

  if (p.isCancel(toMint)) {
    p.cancel('Aborted.');
    process.exit(0);
  }

  // Pick amount
  const fromToken = tokens.find((t) => t.mint === fromMint)!;
  const maxSwappable = fromMint === SOL_MINT
    ? Math.max(0, fromToken.rawAmount - feeReserve)
    : fromToken.rawAmount;
  const maxUi = fromMint === SOL_MINT
    ? maxSwappable / LAMPORTS_PER_SOL
    : maxSwappable / 10 ** fromToken.decimals;

  const amountChoice = await p.select({
    message: `Amount (available: ${maxUi} ${fromToken.symbol})`,
    options: [
      { value: 'all', label: `All — ${maxUi} ${fromToken.symbol}` },
      { value: 'custom', label: 'Enter amount' },
    ],
  });

  if (p.isCancel(amountChoice)) {
    p.cancel('Aborted.');
    process.exit(0);
  }

  let swapAmount: number;

  if (amountChoice === 'all') {
    swapAmount = maxSwappable;
  } else {
    const customAmount = await p.text({
      message: `Amount in ${fromToken.symbol} (UI units, e.g. 0.5)`,
      validate: (val) => {
        const n = parseFloat(val ?? '');
        if (isNaN(n) || n <= 0) return 'Enter a positive number';
        if (n > maxUi) return `Max available: ${maxUi}`;
        return undefined;
      },
    });

    if (p.isCancel(customAmount)) {
      p.cancel('Aborted.');
      process.exit(0);
    }

    swapAmount = Math.floor(parseFloat(customAmount as string) * 10 ** fromToken.decimals);
  }

  // Confirm
  const toToken = tokens.find((t) => t.mint === toMint);
  const toSymbol = toToken?.symbol ?? String(toMint).slice(0, 6);
  const swapUi = swapAmount / 10 ** fromToken.decimals;

  const confirmed = await p.confirm({
    message: `Swap ${swapUi} ${fromToken.symbol} → ${toSymbol}?`,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel('Aborted.');
    process.exit(0);
  }

  // Execute
  const execSpinner = p.spinner();
  execSpinner.start(`Swapping ${swapUi} ${fromToken.symbol} → ${toSymbol}...`);

  try {
    const result = await jupiterSwap(
      { inputMint: fromMint as string, outputMint: toMint as string, amount: swapAmount },
      wallet,
    );

    execSpinner.stop(`Swap complete!`);

    console.log(`
  In:      ${result.inAmount} → Out: ${result.outAmount}
  Impact:  ${result.priceImpactPct}%
  TX:      ${solscanTxUrl(result.signature)}
`);
  } catch (err: unknown) {
    execSpinner.stop('Swap failed.');
    p.cancel(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Script mode (flags)
// ---------------------------------------------------------------------------

async function runScript(args: string[], wallet: WalletService): Promise<void> {
  const fromRaw = getFlag(args, '--from')!;
  const toRaw = getFlag(args, '--to')!;
  const amountRaw = getFlag(args, '--amount');
  const all = hasFlag(args, '--all');

  if (!amountRaw && !all) {
    console.error('Specify --amount <raw> or --all');
    process.exit(1);
  }

  const inputMint = resolveMint(fromRaw);
  const outputMint = resolveMint(toRaw);

  if (inputMint === outputMint) {
    console.error('Input and output mints are the same.');
    process.exit(1);
  }

  const config = loadConfig();
  let amount: number;

  if (all) {
    const balances = await wallet.getBalances();
    if (inputMint === SOL_MINT) {
      const reserve = feeReserveLamports(config);
      amount = Math.max(0, balances.solLamports - reserve);
    } else {
      const token = balances.tokens.find((t) => t.mint === inputMint);
      amount = token ? Number(token.amount) : 0;
    }
    if (amount <= 0) {
      console.error(`No swappable balance for ${fromRaw}.`);
      process.exit(1);
    }
  } else {
    amount = Number(amountRaw);
    if (isNaN(amount) || amount <= 0) {
      console.error(`Invalid amount: ${amountRaw}`);
      process.exit(1);
    }
  }

  console.log(`Swapping ${amount} raw ${fromRaw} → ${toRaw}...`);

  const result = await jupiterSwap(
    { inputMint, outputMint, amount },
    wallet,
  );

  console.log(`Done! ${result.inAmount} → ${result.outAmount}`);
  console.log(`TX: ${solscanTxUrl(result.signature)}`);
}

// ---------------------------------------------------------------------------
// Command entrypoint
// ---------------------------------------------------------------------------

export async function runSwap(args: string[]): Promise<void> {
  const lpcli = new LPCLI();

  let wallet;
  try {
    wallet = await lpcli.getWallet();
  } catch (err: unknown) {
    console.error('Wallet error:', err instanceof Error ? err.message : String(err));
    console.error('Run `lpcli init` to set up your wallet.');
    process.exit(1);
  }

  const hasFlags = args.includes('--from') && args.includes('--to');

  if (hasFlags) {
    await runScript(args, wallet);
  } else {
    await runInteractive(wallet);
  }
}
