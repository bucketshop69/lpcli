/**
 * `lpcli perps` — Pacifica perpetuals operations.
 *
 * Usage:
 *   lpcli perps balance                                    Show Pacifica account balance
 *   lpcli perps positions                                  List open positions with PnL
 *   lpcli perps position <symbol>                          Detailed view of a position
 *   lpcli perps deposit <amount>  [--yes]                  Deposit USDC to Pacifica
 *   lpcli perps withdraw <amount> [--yes]                  Withdraw USDC from Pacifica
 *   lpcli perps trade <symbol> <long|short> <size> [--yes] Place a market order
 *   lpcli perps close <symbol> [--yes]                     Close an open position
 *   lpcli perps cancel [--yes]                             Cancel all open orders
 */

import { createInterface } from 'node:readline';
import {
  LPCLI,
  PacificaClient,
  buildDepositTransaction,
  requestWithdrawal,
  createMarketOrder,
  cancelAllOrders,
  closePosition,
  roundToLotSize,
  PACIFICA_MIN_DEPOSIT_USDC,
} from '@lpcli/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function showBalance(): Promise<void> {
  const lpcli = new LPCLI();
  const wallet = await lpcli.getWallet();
  const address = wallet.getPublicKey().toBase58();
  const client = new PacificaClient();

  try {
    const info = await client.getAccountInfo(address);

    console.log(`\nPacifica Account: ${address}`);
    console.log('─'.repeat(50));
    console.log(`  Balance:            $${parseFloat(info.balance).toFixed(2)}`);
    console.log(`  Account Equity:     $${parseFloat(info.account_equity).toFixed(2)}`);
    console.log(`  Available to Spend: $${parseFloat(info.available_to_spend).toFixed(2)}`);
    console.log(`  Available to Withdraw: $${parseFloat(info.available_to_withdraw).toFixed(2)}`);
    console.log(`  Margin Used:        $${parseFloat(info.total_margin_used).toFixed(2)}`);
    const utilization = parseFloat(info.account_equity) > 0
      ? (parseFloat(info.total_margin_used) / parseFloat(info.account_equity) * 100).toFixed(1)
      : '0.0';
    console.log(`  Margin Utilization: ${utilization}%`);
    console.log(`  Positions:          ${info.positions_count}`);
    console.log(`  Open Orders:        ${info.orders_count + info.stop_orders_count}`);
    console.log('');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
      console.log(`\nPacifica Account: ${address}`);
      console.log('  No account found. Deposit USDC to create your account.');
      console.log('  Usage: lpcli perps deposit <amount>\n');
    } else {
      throw err;
    }
  }
}

async function runDeposit(args: string[]): Promise<void> {
  const amountRaw = args[0];
  const autoConfirm = hasFlag(args, '--yes');

  if (!amountRaw) {
    console.error('Usage: lpcli perps deposit <amount> [--yes]');
    console.error('  amount: USDC amount to deposit (e.g. 10, 50.5)');
    process.exit(1);
  }

  const amount = parseFloat(amountRaw);
  if (isNaN(amount) || amount < PACIFICA_MIN_DEPOSIT_USDC) {
    console.error(`Minimum deposit is $${PACIFICA_MIN_DEPOSIT_USDC} USDC (Pacifica requirement).`);
    process.exit(1);
  }

  const lpcli = new LPCLI();
  const wallet = await lpcli.getWallet();
  const connection = wallet.getConnection();
  const pubkey = wallet.getPublicKey();

  // Check USDC balance
  const usdcBal = await wallet.getTokenBalance('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  const available = usdcBal?.uiAmount ?? 0;

  if (available < amount) {
    console.error(`\nInsufficient USDC. Have: $${available.toFixed(2)}, Need: $${amount.toFixed(2)}`);
    process.exit(1);
  }

  console.log(`\nDeposit to Pacifica:`);
  console.log(`  Wallet: ${pubkey.toBase58()}`);
  console.log(`  Amount: $${amount.toFixed(2)} USDC`);
  console.log(`  USDC Balance: $${available.toFixed(2)}`);
  console.log('');

  if (!autoConfirm) {
    const confirm = await ask('Confirm deposit? [y/N] ');
    if (confirm.toLowerCase() !== 'y') {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  const tx = await buildDepositTransaction(pubkey, amount, connection);
  const signed = await wallet.signTx(tx);
  const sig = await connection.sendRawTransaction(signed.serialize());
  console.log(`Sent: ${sig}`);
  await connection.confirmTransaction(sig, 'confirmed');
  console.log(`Confirmed! Deposited $${amount.toFixed(2)} USDC to Pacifica.`);
  console.log(`https://solscan.io/tx/${sig}\n`);
}

async function runWithdraw(args: string[]): Promise<void> {
  const amountRaw = args[0];
  const autoConfirm = hasFlag(args, '--yes');

  if (!amountRaw) {
    console.error('Usage: lpcli perps withdraw <amount> [--yes]');
    console.error('  amount: USDC amount to withdraw (e.g. 10, 50.5)');
    process.exit(1);
  }

  const amount = parseFloat(amountRaw);
  if (isNaN(amount) || amount < 1) {
    console.error('Amount must be at least $1 (Pacifica minimum).');
    process.exit(1);
  }

  const lpcli = new LPCLI();
  const wallet = await lpcli.getWallet();
  const address = wallet.getPublicKey().toBase58();
  const client = new PacificaClient();

  // Check available to withdraw
  let availableToWithdraw = 0;
  try {
    const info = await client.getAccountInfo(address);
    availableToWithdraw = parseFloat(info.available_to_withdraw);
  } catch {
    console.error('Could not fetch account info. Is your account registered on Pacifica?');
    process.exit(1);
  }

  if (availableToWithdraw < amount) {
    console.error(`\nInsufficient withdrawal balance. Available: $${availableToWithdraw.toFixed(2)}, Requested: $${amount.toFixed(2)}`);
    process.exit(1);
  }

  console.log(`\nWithdraw from Pacifica:`);
  console.log(`  Wallet: ${address}`);
  console.log(`  Amount: $${amount.toFixed(2)} USDC`);
  console.log(`  Available: $${availableToWithdraw.toFixed(2)}`);
  console.log(`  Fee: $1.00`);
  console.log('');

  if (!autoConfirm) {
    const confirm = await ask('Confirm withdrawal? [y/N] ');
    if (confirm.toLowerCase() !== 'y') {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  await requestWithdrawal(wallet, amount, client);
  console.log(`Withdrawal of $${amount.toFixed(2)} USDC requested.`);
  console.log('Note: Pacifica processes withdrawals to your wallet. Check your balance shortly.\n');
}

async function showPositions(): Promise<void> {
  const lpcli = new LPCLI();
  const wallet = await lpcli.getWallet();
  const address = wallet.getPublicKey().toBase58();
  const client = new PacificaClient();

  const [positions, prices] = await Promise.all([
    client.getPositions(address),
    client.getPrices(),
  ]);

  if (positions.length === 0) {
    console.log('\nNo open positions.\n');
    return;
  }

  const priceMap = new Map(prices.map((p) => [p.symbol, parseFloat(p.mark)]));

  console.log(`\nOpen Positions (${positions.length}):`);
  console.log('─'.repeat(70));

  let totalPnl = 0;

  for (const pos of positions) {
    const side = pos.side === 'bid' ? 'LONG' : 'SHORT';
    const size = parseFloat(pos.amount);
    const entry = parseFloat(pos.entry_price);
    const mark = priceMap.get(pos.symbol) ?? entry;
    const direction = pos.side === 'bid' ? 1 : -1;
    const pnl = (mark - entry) * size * direction;
    const pnlPct = entry > 0 && size > 0 ? (pnl / (entry * size)) * 100 : 0;
    totalPnl += pnl;

    const pnlSign = pnl >= 0 ? '+' : '';
    console.log(`  ${pos.symbol} ${side} ${size}`);
    console.log(`    Entry: $${entry.toLocaleString()}  Mark: $${mark.toLocaleString()}`);
    console.log(`    PnL: ${pnlSign}$${pnl.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)`);
  }

  console.log('─'.repeat(70));
  const totalSign = totalPnl >= 0 ? '+' : '';
  console.log(`  Total PnL: ${totalSign}$${totalPnl.toFixed(2)}`);
  console.log('');
}

async function showPosition(args: string[]): Promise<void> {
  const symbol = args[0]?.toUpperCase();

  if (!symbol) {
    console.error('Usage: lpcli perps position <symbol>');
    process.exit(1);
  }

  const lpcli = new LPCLI();
  const wallet = await lpcli.getWallet();
  const address = wallet.getPublicKey().toBase58();
  const client = new PacificaClient();

  const [positions, prices] = await Promise.all([
    client.getPositions(address),
    client.getPrices(),
  ]);

  const pos = positions.find((p) => p.symbol.toUpperCase() === symbol);
  if (!pos) {
    console.error(`No open position for ${symbol}.`);
    const open = positions.map((p) => p.symbol);
    if (open.length > 0) {
      console.error(`Open positions: ${open.join(', ')}`);
    }
    process.exit(1);
  }

  const side = pos.side === 'bid' ? 'LONG' : 'SHORT';
  const size = parseFloat(pos.amount);
  const entry = parseFloat(pos.entry_price);
  const priceInfo = prices.find((p) => p.symbol === pos.symbol);
  const mark = priceInfo ? parseFloat(priceInfo.mark) : entry;
  const direction = pos.side === 'bid' ? 1 : -1;
  const pnl = (mark - entry) * size * direction;
  const pnlPct = entry > 0 && size > 0 ? (pnl / (entry * size)) * 100 : 0;
  const notional = mark * size;
  const pnlSign = pnl >= 0 ? '+' : '';

  console.log(`\n${pos.symbol} — ${side}`);
  console.log('─'.repeat(40));
  console.log(`  Size:        ${size} ${pos.symbol}`);
  console.log(`  Entry Price: $${entry.toLocaleString()}`);
  console.log(`  Mark Price:  $${mark.toLocaleString()}`);
  console.log(`  Notional:    $${notional.toFixed(2)}`);
  console.log(`  PnL:         ${pnlSign}$${pnl.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)`);
  console.log(`  Funding:     $${parseFloat(pos.funding).toFixed(4)}`);
  console.log(`  Isolated:    ${pos.isolated ? 'Yes' : 'No (Cross)'}`);
  console.log(`  Opened:      ${new Date(pos.created_at).toLocaleString()}`);
  console.log('');
}

async function runTrade(args: string[]): Promise<void> {
  const symbol = args[0]?.toUpperCase();
  const direction = args[1]?.toLowerCase();
  const sizeRaw = args[2];
  const autoConfirm = hasFlag(args, '--yes');

  if (!symbol || !direction || !sizeRaw) {
    console.error('Usage: lpcli perps trade <symbol> <long|short> <size> [--yes]');
    console.error('  symbol: Market symbol (e.g. BTC, ETH, SOL)');
    console.error('  long/short: Trade direction');
    console.error('  size: Position size in asset units (e.g. 0.01 BTC)');
    process.exit(1);
  }

  if (direction !== 'long' && direction !== 'short') {
    console.error('Direction must be "long" or "short".');
    process.exit(1);
  }

  const size = parseFloat(sizeRaw);
  if (isNaN(size) || size <= 0) {
    console.error('Size must be a positive number.');
    process.exit(1);
  }

  const side = direction === 'long' ? 'bid' : 'ask' as const;

  const lpcli = new LPCLI();
  const wallet = await lpcli.getWallet();
  const client = new PacificaClient();

  // Validate symbol and get lot size
  const markets = await client.getMarkets();
  const market = markets.find((m) => m.symbol.toUpperCase() === symbol);
  if (!market) {
    const available = markets.map((m) => m.symbol).join(', ');
    console.error(`Unknown symbol: ${symbol}. Available: ${available}`);
    process.exit(1);
  }

  const rounded = roundToLotSize(size, market);
  if (rounded <= 0) {
    console.error(`Size ${size} is below minimum lot size ${market.lot_size} for ${symbol}.`);
    process.exit(1);
  }

  // Get current price for display
  const prices = await client.getPrices();
  const priceInfo = prices.find((p) => p.symbol === market.symbol);
  const markPrice = priceInfo ? parseFloat(priceInfo.mark) : 0;

  console.log(`\nMarket Order:`);
  console.log(`  Symbol:    ${market.symbol}`);
  console.log(`  Direction: ${direction.toUpperCase()}`);
  console.log(`  Size:      ${rounded} ${market.symbol}`);
  if (markPrice > 0) {
    console.log(`  Mark Price: $${markPrice.toLocaleString()}`);
    console.log(`  Notional:  ~$${(rounded * markPrice).toFixed(2)}`);
  }
  console.log(`  Slippage:  1%`);
  console.log('');

  if (!autoConfirm) {
    const confirm = await ask('Confirm trade? [y/N] ');
    if (confirm.toLowerCase() !== 'y') {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  const result = await createMarketOrder(wallet, {
    symbol: market.symbol,
    side,
    amount: rounded,
    slippagePercent: 1,
  }, client);

  console.log(`Order placed! ID: ${result.orderId}`);
  console.log(`  ${direction.toUpperCase()} ${rounded} ${market.symbol}`);
  console.log('');
}

async function runClosePosition(args: string[]): Promise<void> {
  const symbol = args[0]?.toUpperCase();
  const autoConfirm = hasFlag(args, '--yes');

  if (!symbol) {
    console.error('Usage: lpcli perps close <symbol> [--yes]');
    console.error('  symbol: Market symbol of position to close (e.g. BTC, ETH, SOL)');
    process.exit(1);
  }

  const lpcli = new LPCLI();
  const wallet = await lpcli.getWallet();
  const client = new PacificaClient();
  const address = wallet.getPublicKey().toBase58();

  // Find the position
  const positions = await client.getPositions(address);
  const pos = positions.find((p) => p.symbol.toUpperCase() === symbol);

  if (!pos) {
    console.error(`No open position for ${symbol}.`);
    const open = positions.map((p) => p.symbol);
    if (open.length > 0) {
      console.error(`Open positions: ${open.join(', ')}`);
    }
    process.exit(1);
  }

  const size = parseFloat(pos.amount);
  const side = pos.side === 'bid' ? 'LONG' : 'SHORT';
  const entry = parseFloat(pos.entry_price);

  console.log(`\nClose Position:`);
  console.log(`  Symbol:      ${pos.symbol}`);
  console.log(`  Side:        ${side}`);
  console.log(`  Size:        ${size}`);
  console.log(`  Entry Price: $${entry.toLocaleString()}`);
  console.log('');

  if (!autoConfirm) {
    const confirm = await ask('Confirm close? [y/N] ');
    if (confirm.toLowerCase() !== 'y') {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  const result = await closePosition(wallet, symbol, client);
  if (result) {
    console.log(`Close order placed! ID: ${result.orderId}`);
  } else {
    console.error('Failed to close position.');
    process.exit(1);
  }
  console.log('');
}

async function runCancel(args: string[]): Promise<void> {
  const autoConfirm = hasFlag(args, '--yes');

  const lpcli = new LPCLI();
  const wallet = await lpcli.getWallet();
  const client = new PacificaClient();
  const address = wallet.getPublicKey().toBase58();

  // Show current open orders
  const orders = await client.getOpenOrders(address);
  if (orders.length === 0) {
    console.log('No open orders to cancel.');
    return;
  }

  console.log(`\nOpen Orders (${orders.length}):`);
  for (const o of orders) {
    const side = o.side === 'bid' ? 'BUY' : 'SELL';
    console.log(`  ${o.order_id}: ${side} ${o.amount} ${o.symbol} @ $${o.price}`);
  }
  console.log('');

  if (!autoConfirm) {
    const confirm = await ask(`Cancel all ${orders.length} order(s)? [y/N] `);
    if (confirm.toLowerCase() !== 'y') {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  await cancelAllOrders(wallet, client);
  console.log(`Cancelled ${orders.length} order(s).`);
  console.log('');
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export async function runPerps(args: string[]): Promise<void> {
  const subcommand = args[0];

  try {
    switch (subcommand) {
      case 'balance':
        await showBalance();
        break;

      case 'deposit':
        await runDeposit(args.slice(1));
        break;

      case 'withdraw':
        await runWithdraw(args.slice(1));
        break;

      case 'positions':
        await showPositions();
        break;

      case 'position':
        await showPosition(args.slice(1));
        break;

      case 'trade':
        await runTrade(args.slice(1));
        break;

      case 'close':
        await runClosePosition(args.slice(1));
        break;

      case 'cancel':
        await runCancel(args.slice(1));
        break;

      case undefined:
      case '--help':
      case '-h':
        console.log(`
lpcli perps — Pacifica perpetuals

Usage:
  lpcli perps balance                             Show account balance & margin
  lpcli perps positions                           List open positions with PnL
  lpcli perps position <symbol>                   Detailed view of a position
  lpcli perps deposit <amount>                    Deposit USDC to Pacifica
  lpcli perps withdraw <amount>                   Withdraw USDC from Pacifica
  lpcli perps trade <symbol> <long|short> <size>  Place a market order
  lpcli perps close <symbol>                      Close an open position
  lpcli perps cancel                              Cancel all open orders

Options:
  --yes                              Skip confirmation prompt
`);
        break;

      default:
        console.error(`Unknown perps subcommand: ${subcommand}`);
        console.error('Usage: lpcli perps [balance|positions|position|deposit|withdraw|trade|close|cancel]');
        process.exit(1);
    }
  } catch (err: unknown) {
    console.error('Perps error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
