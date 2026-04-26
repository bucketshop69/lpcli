/**
 * Command router — parses user input and returns formatted output lines.
 *
 * Each command function returns OutputLine[] (plain text, bold, dim).
 * No colors — just brightness levels.
 *
 * Session state tracks discover results and multi-step flows (e.g. open position).
 */

import { LPCLI, PacificaClient, WatcherStore, SOL_MINT, MagicBlockClient, executePrivateTransfer, signAndSendMagicBlockTx, ensureBurnerWallet, fundBurner } from './deps.js';
import type { DiscoveredPool, FundedOpenResult, Condition, Action } from './deps.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface OutputLine {
  type: 'text' | 'blank';
  text?: string;
  bold?: boolean;
  dim?: boolean;
}

const blank: OutputLine = { type: 'blank' };

function text(s: string, opts?: { bold?: boolean; dim?: boolean }): OutputLine {
  return { type: 'text', text: s, ...opts };
}
function bold(s: string): OutputLine { return text(s, { bold: true }); }
function dim(s: string): OutputLine { return text(s, { dim: true }); }

// ─────────────────────────────────────────────────────────────────────────────
// Session state — persists across commands within one TUI session
// ─────────────────────────────────────────────────────────────────────────────

interface PendingOpen {
  step: 'amount' | 'strategy' | 'confirm' | 'visibility';
  pool: DiscoveredPool;
  amount?: number;         // UI amount in funding token
  strategy?: 'spot' | 'bidask' | 'curve';
}

const session = {
  lastDiscover: [] as DiscoveredPool[],
  pendingOpen: undefined as PendingOpen | undefined,
};

/**
 * Returns a contextual placeholder based on current session state.
 */
export function getPlaceholder(): string {
  const p = session.pendingOpen;
  if (p) {
    switch (p.step) {
      case 'amount': return 'amount (e.g. 200), or /cancel';
      case 'strategy': return '1-3 or spot/bidask/curve, enter for spot';
      case 'confirm': return 'y to confirm, anything else to cancel';
      case 'visibility': return '1 for public, 2 for private';
    }
  }
  if (session.lastDiscover.length > 0) {
    return 'type a number to open, or /command...';
  }
  return 'type /help or a command...';
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

export async function runCommand(raw: string): Promise<OutputLine[]> {
  const trimmed = raw.trim();

  // ── Handle multi-step flows first ──────────────────────────────────────
  if (session.pendingOpen) {
    return handlePendingOpen(trimmed);
  }

  // ── Check if input is a number (pool selection from discover) ──────────
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && trimmed === String(num) && session.lastDiscover.length > 0) {
    return selectPool(num);
  }

  // ── Normal command routing ─────────────────────────────────────────────
  const normalized = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  const parts = normalized.split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {
    case 'help':
    case 'h':
      return cmdHelp();

    case 'status':
    case 's':
      return cmdStatus();

    case 'wallet':
    case 'w':
      return cmdWallet(args);

    case 'meteora':
    case 'm':
      return cmdMeteora(args);

    case 'pacific':
    case 'p':
      return cmdPacific(args);

    case 'mp':
      return cmdMeteora(['positions']);

    case 'pp':
      return cmdPacific(['positions']);

    case 'monitor':
    case 'mon':
      return cmdMonitor(args);

    case 'transfer':
    case 't':
      return cmdTransfer(args);

    case 'private':
    case 'priv':
      return cmdPrivate(args);

    case 'cancel':
    case 'c':
      session.pendingOpen = undefined;
      session.lastDiscover = [];
      return [dim('  cancelled')];

    default:
      return [
        dim(`  unknown command: ${cmd}`),
        dim('  type /help for available commands'),
      ];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pool selection → open flow
// ─────────────────────────────────────────────────────────────────────────────

async function selectPool(num: number): Promise<OutputLine[]> {
  const idx = num - 1;
  if (idx < 0 || idx >= session.lastDiscover.length) {
    return [dim(`  invalid selection — pick 1-${session.lastDiscover.length}`)];
  }

  const pool = session.lastDiscover[idx];
  const lpcli = new LPCLI();
  const funding = lpcli.getFundingToken();

  session.pendingOpen = { step: 'amount', pool };

  const lines: OutputLine[] = [
    bold(`  ${pool.name}`),
    dim(`  ${pool.pool_address}`),
    blank,
    text(`  TVL: ${fmtMoney(pool.tvl)}  |  Fee/TVL: ${(pool.fee_active_tvl_ratio * 100).toFixed(1)}%  |  Vol: ${fmtMoney(pool.volume_24h)}`),
    blank,
  ];

  // Show wallet balances for context
  try {
    const wallet = await lpcli.getWallet();
    const balances = await wallet.getBalances();

    const fundingBal = balances.tokens.find((t: { mint: string }) => t.mint === funding.mint);
    const tokenXBal = balances.tokens.find((t: { mint: string }) => t.mint === pool.token_x_mint);
    const tokenYBal = balances.tokens.find((t: { mint: string }) => t.mint === pool.token_y_mint);

    lines.push(dim('  Your balances:'));
    lines.push(text(`  SOL:    ${balances.solBalance.toFixed(4)}`));
    lines.push(text(`  ${funding.symbol.padEnd(5)} ${fundingBal ? fundingBal.uiAmount : 0}`));

    // Show token X/Y balances if they differ from SOL and funding
    const skip = new Set([funding.mint, SOL_MINT]);
    if (!skip.has(pool.token_x_mint)) {
      lines.push(text(`  ${pool.token_x.padEnd(5)} ${tokenXBal ? tokenXBal.uiAmount : 0}`));
    }
    if (!skip.has(pool.token_y_mint) && pool.token_y_mint !== pool.token_x_mint) {
      lines.push(text(`  ${pool.token_y.padEnd(5)} ${tokenYBal ? tokenYBal.uiAmount : 0}`));
    }
    lines.push(blank);
  } catch {
    lines.push(dim('  (wallet not available — run lpcli init)'), blank);
  }

  lines.push(bold(`  Enter amount in ${funding.symbol} (or /cancel):`));

  return lines;
}

async function handlePendingOpen(input: string): Promise<OutputLine[]> {
  const pending = session.pendingOpen!;

  // Cancel at any step
  if (input === '/cancel' || input === 'cancel' || input === 'c') {
    session.pendingOpen = undefined;
    return [dim('  cancelled')];
  }

  // ── Step 1: amount ─────────────────────────────────────────────────────
  if (pending.step === 'amount') {
    const amount = parseFloat(input);
    if (isNaN(amount) || amount <= 0) {
      return [dim('  enter a positive number, or /cancel')];
    }

    pending.amount = amount;
    pending.step = 'strategy';

    return [
      text(`  amount: ${amount}`),
      blank,
      bold('  Strategy:'),
      text('  1) spot     — balanced around active price (default)'),
      text('  2) bidask   — concentrated, one-sided'),
      text('  3) curve    — wider bell-curve distribution'),
      blank,
      bold('  Pick 1-3 or press enter for spot:'),
    ];
  }

  // ── Step 2: strategy ───────────────────────────────────────────────────
  if (pending.step === 'strategy') {
    const strategies = ['spot', 'bidask', 'curve'] as const;
    let strategy: 'spot' | 'bidask' | 'curve' = 'spot';

    if (input === '' || input === '1') {
      strategy = 'spot';
    } else if (input === '2' || input === 'bidask') {
      strategy = 'bidask';
    } else if (input === '3' || input === 'curve') {
      strategy = 'curve';
    } else if (strategies.includes(input as typeof strategies[number])) {
      strategy = input as typeof strategies[number];
    } else {
      return [dim('  pick 1-3, or type spot/bidask/curve')];
    }

    pending.strategy = strategy;
    pending.step = 'confirm';

    const lpcli = new LPCLI();
    const funding = lpcli.getFundingToken();

    return [
      blank,
      bold('  Confirm open position:'),
      text(`  Pool:      ${pending.pool.name} (${pending.pool.pool_address.slice(0, 8)}..)`),
      text(`  Amount:    ${pending.amount} ${funding.symbol}`),
      text(`  Strategy:  ${strategy}`),
      text(`  Split:     50/50`),
      blank,
      bold('  y to confirm, anything else to cancel:'),
    ];
  }

  // ── Step 3: confirm → ask visibility ────────────────────────────────────
  if (pending.step === 'confirm') {
    if (input.toLowerCase() !== 'y') {
      session.pendingOpen = undefined;
      return [dim('  aborted')];
    }

    pending.step = 'visibility';
    return [
      blank,
      bold('  Visibility:'),
      text('  1) public    — open directly from your wallet'),
      text('  2) private   — route through MagicBlock PER (burner wallet)'),
      blank,
      bold('  Pick 1 or 2 (enter for public):'),
    ];
  }

  // ── Step 4: visibility & execute ──────────────────────────────────────
  if (pending.step === 'visibility') {
    const isPrivate = input === '2' || input.toLowerCase() === 'private';
    const pool = pending.pool;
    const amount = pending.amount!;
    const strategy = pending.strategy!;

    // Clear pending before async work
    session.pendingOpen = undefined;

    try {
      const lpcli = new LPCLI();
      const funding = lpcli.getFundingToken();
      const amountSmallest = Math.floor(amount * 10 ** funding.decimals);

      if (isPrivate) {
        // Private flow: fund burner via PER → open from burner
        const lines: OutputLine[] = [
          blank,
          dim('  Setting up private position...'),
          dim('  Creating burner wallet (if needed)...'),
        ];

        const result = await lpcli.openPrivate({
          pool: pool.pool_address,
          amount: amountSmallest,
          ratioX: 0.5,
          strategy,
        });

        const pos = result.position;
        return [
          ...lines,
          blank,
          bold('  Private position opened!'),
          blank,
          text(`  Position:  ${pos.position.slice(0, 12)}..`),
          text(`  Burner:    ${result.burnerAddress.slice(0, 12)}..`),
          text(`  Range:     ${pos.range_low.toFixed(6)} — ${pos.range_high.toFixed(6)}`),
          text(`  Deposited: ${pos.deposited_x_ui.toFixed(4)} ${pos.token_x_symbol}  +  ${pos.deposited_y_ui.toFixed(4)} ${pos.token_y_symbol}`),
          text(`  Fund TX:   ${result.fundTx}`),
          text(`  Open TX:   ${pos.tx}`),
          result.gasTx ? text(`  Gas TX:    ${result.gasTx}`) : blank,
          blank,
          dim('  No on-chain link between your main wallet and this position.'),
        ];
      } else {
        // Public flow: open directly from main wallet
        const result: FundedOpenResult = await lpcli.openWithFunding({
          pool: pool.pool_address,
          amount: amountSmallest,
          ratioX: 0.5,
          strategy,
        });

        const pos = result.position;
        return [
          blank,
          bold('  Position opened!'),
          blank,
          text(`  Position:  ${pos.position.slice(0, 12)}..`),
          text(`  Range:     ${pos.range_low.toFixed(6)} — ${pos.range_high.toFixed(6)}`),
          text(`  Deposited: ${pos.deposited_x_ui.toFixed(4)} ${pos.token_x_symbol}  +  ${pos.deposited_y_ui.toFixed(4)} ${pos.token_y_symbol}`),
          text(`  TX:        ${pos.tx}`),
          text(`  Swaps:     ${result.swaps.length}`),
        ];
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return [
        dim(`  failed to open: ${msg}`),
      ];
    }
  }

  session.pendingOpen = undefined;
  return [dim('  something went wrong — try again')];
}

// ─────────────────────────────────────────────────────────────────────────────
// /help
// ─────────────────────────────────────────────────────────────────────────────

function cmdHelp(): OutputLine[] {
  return [
    bold('  Commands'),
    blank,
    text('  /meteora           LP positions, discover pools, open/close'),
    text('  /pacific           perp positions, balance, markets'),
    text('  /transfer          send tokens (public or --private)'),
    text('  /private           private ops via MagicBlock PERs'),
    text('  /monitor           watchers list'),
    text('  /wallet            balance info'),
    text('  /status            overview of everything'),
    blank,
    bold('  Shortcuts'),
    blank,
    text('  /mp                meteora positions'),
    text('  /pp                pacific positions'),
    text('  /s                 status overview'),
    text('  /w                 wallet info'),
    blank,
    bold('  Flows'),
    blank,
    text('  /meteora discover  → type a number to open that pool'),
    text('  /transfer <addr> <amt> --private'),
    text('  /private fund <amt>  fund burner via PER'),
    text('  /cancel            cancel any in-progress flow'),
    blank,
    dim('  /meteora help or /pacific help for subcommands.'),
    dim('  q to quit.'),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// /wallet
// ─────────────────────────────────────────────────────────────────────────────

async function cmdWallet(args: string[]): Promise<OutputLine[]> {
  const sub = args[0];

  const lpcli = new LPCLI();
  let wallet;
  try {
    wallet = await lpcli.getWallet();
  } catch {
    return [dim('  wallet not configured — run lpcli init')];
  }

  const balances = await wallet.getBalances();

  if (sub === 'address') {
    return [text(`  ${balances.address}`)];
  }

  const funding = lpcli.getFundingToken();
  const fundingBal = balances.tokens.find((t: { mint: string }) => t.mint === funding.mint);

  const lines: OutputLine[] = [
    bold('  Main Wallet'),
    text(`  Address:  ${balances.address}`),
    text(`  SOL:      ${balances.solBalance.toFixed(4)} SOL`),
    text(`  ${funding.symbol}:     ${fundingBal ? fundingBal.uiAmount : 0} ${funding.symbol}`),
  ];

  if (sub === 'balance') {
    if (balances.tokens.length > 0) {
      lines.push(blank, bold('  SPL Tokens'));
      for (const t of balances.tokens) {
        const addr = `${t.mint.slice(0, 6)}..${t.mint.slice(-4)}`;
        lines.push(text(`  ${addr}  ${t.uiAmount}`));
      }
    }
  }

  // Show burner wallet if it exists
  const burner = await lpcli.getBurnerWallet();
  if (burner) {
    const burnerBal = await burner.getBalances();
    const burnerFunding = burnerBal.tokens.find((t: { mint: string }) => t.mint === funding.mint);
    lines.push(
      blank,
      bold('  Burner Wallet (private ops)'),
      text(`  Address:  ${burnerBal.address}`),
      text(`  SOL:      ${burnerBal.solBalance.toFixed(4)} SOL`),
      text(`  ${funding.symbol}:     ${burnerFunding ? burnerFunding.uiAmount : 0} ${funding.symbol}`),
    );
  }

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// /meteora
// ─────────────────────────────────────────────────────────────────────────────

async function cmdMeteora(args: string[]): Promise<OutputLine[]> {
  const sub = args[0]?.toLowerCase();

  if (!sub || sub === 'help') {
    return [
      bold('  Meteora'),
      blank,
      text('  /meteora positions       your LP positions'),
      text('  /meteora discover [tok]  find pools (type # to open)'),
      text('  /meteora open <pool>     open position on a pool'),
      text('  /meteora close <pos>     close a position'),
      text('  /meteora claim <pos>     claim fees'),
      blank,
      dim('  discover → pick a number → guided open flow'),
    ];
  }

  if (sub === 'positions' || sub === 'pos') {
    return cmdMeteoraPositions();
  }

  if (sub === 'discover' || sub === 'disc') {
    return cmdMeteoraDiscover(args.slice(1));
  }

  if (sub === 'open') {
    return cmdMeteoraOpen(args.slice(1));
  }

  if (sub === 'close') {
    return cmdMeteoraClose(args.slice(1));
  }

  if (sub === 'claim') {
    return cmdMeteoraClaim(args.slice(1));
  }

  return [dim(`  unknown: /meteora ${sub} — try /meteora help`)];
}

async function cmdMeteoraPositions(): Promise<OutputLine[]> {
  const lpcli = new LPCLI();
  let wallet;
  try {
    wallet = await lpcli.getWallet();
  } catch {
    return [dim('  wallet not configured — run lpcli init')];
  }

  const dlmm = lpcli.dlmm!;
  const addr = wallet.getPublicKey().toBase58();
  const positions = await dlmm.getPositions(addr);

  if (positions.length === 0) {
    return [dim('  no open LP positions')];
  }

  const lines: OutputLine[] = [
    bold('  Meteora LP Positions'),
    dim('  ────────────────────────────────────────────────────'),
  ];

  for (const p of positions) {
    const status = p.status === 'in_range' ? 'IN RANGE' : 'OUT OF RANGE';
    const valX = p.current_value_x_ui.toFixed(4);
    const valY = p.current_value_y_ui.toFixed(4);
    const feeX = p.fees_earned_x_ui.toFixed(4);
    const feeY = p.fees_earned_y_ui.toFixed(4);
    const parts = p.pool_name.split('-');
    const symX = parts[0] || '?';
    const symY = parts.slice(1).join('-') || '?';

    lines.push(text(`  ${p.pool_name}  ${status}`, { bold: p.status === 'in_range' }));
    lines.push(dim(`    value: ${valX} ${symX} + ${valY} ${symY}  |  fees: ${feeX} ${symX} + ${feeY} ${symY}`));
    lines.push(dim(`    range: ${p.range_low.toFixed(4)} — ${p.range_high.toFixed(4)}  |  price: ${p.current_price.toFixed(4)}`));
  }

  lines.push(blank);
  lines.push(dim(`  ${positions.length} position(s)`));

  return lines;
}

async function cmdMeteoraDiscover(args: string[]): Promise<OutputLine[]> {
  const query = args.join(' ').toUpperCase() || undefined;

  const lpcli = new LPCLI();
  const pools = await lpcli.discoverPools(query);

  if (pools.length === 0) {
    return [dim(`  no pools found${query ? ` for ${query}` : ''}`)];
  }

  // Store for number selection
  session.lastDiscover = pools.slice(0, 30);
  const show = pools.slice(0, 10);

  const lines: OutputLine[] = [
    bold(`  ${query || 'Top'} Pools`),
    dim('  ────────────────────────────────────────────────────────────────────────'),
    dim('  #   Pair              Bin    TVL         Fee/TVL    Vol 24h      Swaps'),
  ];

  for (let i = 0; i < show.length; i++) {
    const p = show[i];
    const num = String(i + 1).padEnd(3);
    const pair = p.name.padEnd(16);
    const bin = String(p.bin_step).padEnd(6);
    const tvl = fmtMoney(p.tvl).padEnd(11);
    const feeRatio = `${(p.fee_active_tvl_ratio * 100).toFixed(1)}%`.padStart(6);
    const vol = fmtMoney(p.volume_24h).padEnd(12);
    const swaps = String(Math.round(p.swap_count));
    lines.push(text(`  ${num} ${pair} ${bin} ${tvl} ${feeRatio}      ${vol} ${swaps}`));
  }

  if (pools.length > 10) {
    lines.push(dim(`  ... and ${pools.length - 10} more`));
  }

  lines.push(blank);
  lines.push(bold('  Type a number to open a position on that pool'));

  return lines;
}

async function cmdMeteoraOpen(args: string[]): Promise<OutputLine[]> {
  const poolAddr = args[0];
  if (!poolAddr) {
    return [
      dim('  usage: /meteora open <pool_address>'),
      dim('  or use /meteora discover and pick a number'),
    ];
  }

  // Construct a minimal DiscoveredPool to reuse the open flow
  session.pendingOpen = {
    step: 'amount',
    pool: { pool_address: poolAddr, name: poolAddr.slice(0, 12) + '...' } as DiscoveredPool,
  };

  const lpcli = new LPCLI();
  const funding = lpcli.getFundingToken();

  return [
    text(`  Pool: ${poolAddr}`),
    blank,
    bold(`  Enter amount in ${funding.symbol} (or /cancel):`),
  ];
}

async function cmdMeteoraClose(args: string[]): Promise<OutputLine[]> {
  const posAddr = args[0];
  const poolAddr = args[1];

  if (!posAddr) {
    return [
      dim('  usage: /meteora close <position_address> [pool_address]'),
      dim('  tip: get addresses from /meteora positions'),
    ];
  }

  try {
    const lpcli = new LPCLI();
    await lpcli.getWallet();
    const result = await lpcli.closeToFunding(posAddr, poolAddr || posAddr);

    const c = result.close;
    return [
      bold('  Position closed!'),
      blank,
      text(`  Withdrawn: ${c.withdrawn_x_ui.toFixed(4)} ${c.token_x_symbol}  +  ${c.withdrawn_y_ui.toFixed(4)} ${c.token_y_symbol}`),
      text(`  Fees:      ${c.claimed_fees_x_ui.toFixed(4)} ${c.token_x_symbol}  +  ${c.claimed_fees_y_ui.toFixed(4)} ${c.token_y_symbol}`),
      text(`  TX:        ${c.tx}`),
      text(`  Swaps:     ${result.swaps.length} swap(s) back to funding token`),
    ];
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return [dim(`  close failed: ${msg}`)];
  }
}

async function cmdMeteoraClaim(args: string[]): Promise<OutputLine[]> {
  const posAddr = args[0];

  if (!posAddr) {
    return [dim('  usage: /meteora claim <position_address>')];
  }

  try {
    const lpcli = new LPCLI();
    await lpcli.getWallet();
    const result = await lpcli.claimToFunding(posAddr);

    return [
      bold('  Fees claimed!'),
      blank,
      text(`  Claimed: ${result.claim.claimedX} X  +  ${result.claim.claimedY} Y`),
      text(`  TX:      ${result.claim.tx}`),
      text(`  Swaps:   ${result.swaps.length} swap(s) back to funding token`),
    ];
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return [dim(`  claim failed: ${msg}`)];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// /pacific
// ─────────────────────────────────────────────────────────────────────────────

async function cmdPacific(args: string[]): Promise<OutputLine[]> {
  const sub = args[0]?.toLowerCase();

  if (!sub || sub === 'help') {
    return [
      bold('  Pacifica Perpetuals'),
      blank,
      text('  /pacific positions       open perp positions'),
      text('  /pacific balance         account balance & margin'),
      text('  /pacific markets         available markets'),
      blank,
      dim('  trading commands coming — trade/close/cancel/limit'),
    ];
  }

  if (sub === 'positions' || sub === 'pos') {
    return cmdPacificPositions();
  }

  if (sub === 'balance' || sub === 'bal') {
    return cmdPacificBalance();
  }

  if (sub === 'markets') {
    return cmdPacificMarkets();
  }

  return [dim(`  unknown: /pacific ${sub} — try /pacific help`)];
}

async function cmdPacificPositions(): Promise<OutputLine[]> {
  const lpcli = new LPCLI();
  let wallet;
  try {
    wallet = await lpcli.getWallet();
  } catch {
    return [dim('  wallet not configured — run lpcli init')];
  }

  const address = wallet.getPublicKey().toBase58();
  const client = new PacificaClient();
  const positions = await client.getPositions(address);

  if (positions.length === 0) {
    return [dim('  no open perp positions')];
  }

  // Fetch prices for mark price
  let priceMap: Record<string, string> = {};
  try {
    const prices = await client.getPrices();
    for (const p of prices) {
      priceMap[p.symbol] = p.mark;
    }
  } catch { /* proceed without mark prices */ }

  const lines: OutputLine[] = [
    bold('  Pacifica Positions'),
    dim('  ────────────────────────────────────────────────────'),
  ];

  for (const p of positions) {
    const side = p.side === 'bid' ? 'LONG' : 'SHORT';
    const size = parseFloat(p.amount);
    const entry = parseFloat(p.entry_price);
    const mark = priceMap[p.symbol] ? parseFloat(priceMap[p.symbol]) : entry;
    const symbol = p.symbol.replace('-PERP', '');

    // Calculate uPnL
    const pnl = p.side === 'bid'
      ? (mark - entry) * size
      : (entry - mark) * size;
    const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;

    lines.push(text(`  ${p.symbol.padEnd(12)} ${side.padEnd(6)} ${size} ${symbol}`));
    lines.push(dim(`    entry: $${entry.toFixed(2)}  |  mark: $${mark.toFixed(2)}  |  uPnL: ${pnlStr}`));
  }

  return lines;
}

async function cmdPacificBalance(): Promise<OutputLine[]> {
  const lpcli = new LPCLI();
  let wallet;
  try {
    wallet = await lpcli.getWallet();
  } catch {
    return [dim('  wallet not configured — run lpcli init')];
  }

  const address = wallet.getPublicKey().toBase58();
  const client = new PacificaClient();
  const info = await client.getAccountInfo(address);

  const equity = parseFloat(info.account_equity);
  const margin = parseFloat(info.total_margin_used);
  const available = parseFloat(info.available_to_spend);
  const utilization = equity > 0 ? (margin / equity * 100).toFixed(1) : '0.0';

  return [
    bold('  Pacifica Account'),
    dim('  ────────────────────────────────────────────────────'),
    text(`  Equity:        $${equity.toFixed(2)}`),
    text(`  Margin used:   $${margin.toFixed(2)} (${utilization}%)`),
    text(`  Available:     $${available.toFixed(2)}`),
    text(`  Positions:     ${info.positions_count}`),
  ];
}

async function cmdPacificMarkets(): Promise<OutputLine[]> {
  const client = new PacificaClient();
  const markets = await client.getMarkets();
  const prices = await client.getPrices();

  const priceMap: Record<string, { mark: string; volume: string }> = {};
  for (const p of prices) {
    priceMap[p.symbol] = { mark: p.mark, volume: p.volume_24h };
  }

  const lines: OutputLine[] = [
    bold('  Pacifica Markets'),
    dim('  ────────────────────────────────────────────────────'),
    dim('  Symbol         Mark         Funding      Vol 24h'),
  ];

  for (const m of markets) {
    const p = priceMap[m.symbol];
    const mark = p ? `$${parseFloat(p.mark).toFixed(2)}` : '';
    const vol = p ? fmtMoney(parseFloat(p.volume)) : '';
    const funding = m.funding_rate ? `${(parseFloat(m.funding_rate) * 100).toFixed(4)}%` : '';
    lines.push(text(`  ${m.symbol.padEnd(14)} ${mark.padEnd(12)} ${funding.padEnd(12)} ${vol}`));
  }

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// /monitor
// ─────────────────────────────────────────────────────────────────────────────

async function cmdMonitor(args: string[]): Promise<OutputLine[]> {
  const sub = args[0]?.toLowerCase();

  if (!sub || sub === 'help') {
    return [
      bold('  Monitor'),
      blank,
      text('  /monitor list            show all watchers'),
      blank,
      dim('  add/remove/run via CLI: lpcli monitor add'),
    ];
  }

  if (sub === 'list' || sub === 'ls') {
    return cmdMonitorList();
  }

  return [dim(`  unknown: /monitor ${sub} — try /monitor help`)];
}

async function cmdMonitorList(): Promise<OutputLine[]> {
  const store = new WatcherStore();
  const watchers = store.list();

  if (watchers.length === 0) {
    return [dim('  no watchers configured — run lpcli monitor add')];
  }

  const lines: OutputLine[] = [
    bold(`  Watchers (${watchers.length})`),
    dim('  ────────────────────────────────────────────────────'),
  ];

  for (const w of watchers) {
    const status = w.enabled ? 'watching' : 'disabled';
    const triggered = w.triggerCount > 0 ? ` (triggered ${w.triggerCount}x)` : '';
    const condStr = w.conditions.map(fmtCondition).join(' AND ');
    const actStr = fmtAction(w.action);

    lines.push(text(`  ${w.name.padEnd(20)} ${condStr} -> ${actStr}`, { bold: w.enabled }));
    lines.push(dim(`    ${status}${triggered}${w.lastError ? ` [err: ${w.lastError}]` : ''}`));
  }

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// /status
// ─────────────────────────────────────────────────────────────────────────────

async function cmdStatus(): Promise<OutputLine[]> {
  const lines: OutputLine[] = [];

  // Wallet
  const walletLines = await cmdWallet([]);
  lines.push(...walletLines, blank);

  // Pacifica
  try {
    const pacLines = await cmdPacificPositions();
    lines.push(...pacLines, blank);
  } catch {
    lines.push(dim('  pacifica: could not fetch positions'), blank);
  }

  // Meteora
  try {
    const metLines = await cmdMeteoraPositions();
    lines.push(...metLines, blank);
  } catch {
    lines.push(dim('  meteora: could not fetch positions'), blank);
  }

  // Monitor
  try {
    const monLines = await cmdMonitorList();
    lines.push(...monLines);
  } catch {
    lines.push(dim('  monitor: could not load watchers'));
  }

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// /transfer
// ─────────────────────────────────────────────────────────────────────────────

async function cmdTransfer(args: string[]): Promise<OutputLine[]> {
  const sub = args[0]?.toLowerCase();

  if (!sub || sub === 'help') {
    return [
      bold('  Transfer'),
      blank,
      text('  /transfer <address> <amount> [--private]'),
      blank,
      text('  Sends USDC (funding token) to an address.'),
      text('  Add --private to route through MagicBlock PER.'),
      blank,
      dim('  example: /transfer 7xKp...3mNq 50 --private'),
    ];
  }

  const isPrivate = args.includes('--private');
  const cleanArgs = args.filter((a) => a !== '--private');
  const address = cleanArgs[0];
  const amountStr = cleanArgs[1];

  if (!address || !amountStr) {
    return [dim('  usage: /transfer <address> <amount> [--private]')];
  }

  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    return [dim('  amount must be a positive number')];
  }

  try {
    const lpcli = new LPCLI();
    const wallet = await lpcli.getWallet();
    const funding = lpcli.getFundingToken();

    if (isPrivate) {
      const result = await executePrivateTransfer(wallet, {
        to: address,
        amount,
        mint: funding.mint,
      });

      return [
        bold('  Private transfer sent!'),
        blank,
        text(`  Amount:     ${amount} ${funding.symbol}`),
        text(`  To:         ${address.slice(0, 12)}..`),
        text(`  Visibility: private (MagicBlock PER)`),
        text(`  TX:         ${result.txSignature}`),
        blank,
        dim('  No on-chain link between sender and recipient.'),
      ];
    } else {
      const rawAmount = Math.floor(amount * 10 ** funding.decimals);
      const result = await wallet.transferToken({
        to: address,
        mint: funding.mint,
        amount: rawAmount,
      });

      return [
        bold('  Transfer sent!'),
        blank,
        text(`  Amount:  ${amount} ${funding.symbol}`),
        text(`  To:      ${address.slice(0, 12)}..`),
        text(`  TX:      ${result.signature}`),
      ];
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return [dim(`  transfer failed: ${msg}`)];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// /private
// ─────────────────────────────────────────────────────────────────────────────

async function cmdPrivate(args: string[]): Promise<OutputLine[]> {
  const sub = args[0]?.toLowerCase();

  if (!sub || sub === 'help') {
    return [
      bold('  Private (MagicBlock PERs)'),
      blank,
      text('  /private fund <amount>     fund burner wallet via PER'),
      text('  /private balance           check PER balance'),
      text('  /private health            check MagicBlock API status'),
      blank,
      dim('  Private transfers break the on-chain link between wallets.'),
      dim('  Uses MagicBlock Private Ephemeral Rollups (TEE-based).'),
    ];
  }

  if (sub === 'fund') {
    return cmdPrivateFund(args.slice(1));
  }

  if (sub === 'balance' || sub === 'bal') {
    return cmdPrivateBalance();
  }

  if (sub === 'health') {
    return cmdPrivateHealth();
  }

  return [dim(`  unknown: /private ${sub} — try /private help`)];
}

async function cmdPrivateFund(args: string[]): Promise<OutputLine[]> {
  const amountStr = args[0];

  if (!amountStr) {
    return [dim('  usage: /private fund <amount>')];
  }

  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    return [dim('  amount must be a positive number')];
  }

  try {
    const lpcli = new LPCLI();
    const mainWallet = await lpcli.getWallet();
    const funding = lpcli.getFundingToken();
    const from = mainWallet.getPublicKey().toBase58();

    // Ensure burner wallet exists (auto-create if needed)
    const burnerWallet = await ensureBurnerWallet(lpcli.config.rpcUrl);
    const burnerAddr = burnerWallet.getPublicKey().toBase58();

    // Fund burner via PER + gas
    const { transfer, gasTx } = await fundBurner(
      mainWallet,
      burnerWallet,
      amount,
      funding.mint,
    );

    const lines: OutputLine[] = [
      bold('  Burner funded!'),
      blank,
      text(`  Amount:  ${amount} ${funding.symbol}`),
      text(`  From:    ${from.slice(0, 12)}..`),
      text(`  Burner:  ${burnerAddr.slice(0, 12)}..`),
      text(`  TX:      ${transfer.txSignature}`),
    ];

    if (gasTx) {
      lines.push(dim(`  Gas TX:  ${gasTx} (0.005 SOL for fees)`));
    }

    lines.push(blank, dim('  No on-chain link between main wallet and burner.'));

    return lines;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return [dim(`  private fund failed: ${msg}`)];
  }
}

async function cmdPrivateBalance(): Promise<OutputLine[]> {
  try {
    const lpcli = new LPCLI();
    const wallet = await lpcli.getWallet();
    const funding = lpcli.getFundingToken();
    const address = wallet.getPublicKey().toBase58();
    const client = new MagicBlockClient();

    const [base, priv] = await Promise.all([
      client.getBalance(address, funding.mint).catch(() => null),
      client.getPrivateBalance(address, funding.mint).catch(() => null),
    ]);

    const lines: OutputLine[] = [
      bold('  MagicBlock Balances'),
      dim('  ────────────────────────────────────────────────────'),
      text(`  Base (Solana):    ${base ? base.amount : 'unavailable'}`),
      text(`  Ephemeral (PER): ${priv ? priv.amount : 'unavailable'}`),
    ];

    // Show burner wallet balance if it exists
    const burnerWallet = await lpcli.getBurnerWallet();
    if (burnerWallet) {
      const burnerAddr = burnerWallet.getPublicKey().toBase58();
      const burnerBalances = await burnerWallet.getBalances();
      const burnerFunding = burnerBalances.tokens.find((t: { mint: string }) => t.mint === funding.mint);

      lines.push(
        blank,
        bold('  Burner Wallet'),
        dim('  ────────────────────────────────────────────────────'),
        text(`  Address:  ${burnerAddr}`),
        text(`  SOL:      ${burnerBalances.solBalance.toFixed(4)}`),
        text(`  ${funding.symbol}:     ${burnerFunding ? burnerFunding.uiAmount : 0}`),
      );
    } else {
      lines.push(blank, dim('  Burner wallet: not created yet (auto-created on first private action)'));
    }

    return lines;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return [dim(`  balance check failed: ${msg}`)];
  }
}

async function cmdPrivateHealth(): Promise<OutputLine[]> {
  const client = new MagicBlockClient();
  const healthy = await client.healthCheck();

  return [
    text(`  MagicBlock API: ${healthy ? 'online' : 'unreachable'}`, { bold: healthy }),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtCondition(c: Condition): string {
  switch (c.type) {
    case 'rsi': return `RSI ${c.symbol} ${c.timeframe} ${c.op} ${c.value}`;
    case 'price': return `${c.symbol} ${c.op} $${c.value}`;
    case 'funding_rate': return `funding ${c.symbol} ${c.op} ${c.value}`;
    case 'position_status': return `pool ${c.pool.slice(0, 8)}.. ${c.status}`;
    case 'has_position': return `has ${c.protocol} pos: ${c.identifier}`;
  }
}

function fmtAction(a: Action): string {
  switch (a.type) {
    case 'alert': return `alert${a.message ? `: ${a.message}` : ''}`;
    case 'trade': return `trade ${a.side} ${a.amount} ${a.symbol}`;
    case 'close_perp': return `close_perp ${a.symbol}`;
    case 'close_lp': return `close_lp ${a.pool.slice(0, 8)}..`;
    case 'webhook': return `webhook`;
  }
}
