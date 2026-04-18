/**
 * `lpcli monitor` — manage and run monitoring watchers.
 *
 * Usage:
 *   lpcli monitor add         Interactive watcher creation
 *   lpcli monitor list         List all watchers
 *   lpcli monitor remove <id>  Remove a watcher
 *   lpcli monitor run          Start the monitor engine (foreground)
 *   lpcli monitor clear        Remove all watchers
 */

import {
  MonitorEngine,
  WatcherStore,
  VALID_INTERVALS,
} from '@lpcli/monitor';
import type { Condition, Action } from '@lpcli/monitor';
import { createRL, ask, hasFlag } from '../helpers.js';

// ---------------------------------------------------------------------------
// Interactive add
// ---------------------------------------------------------------------------

async function runAdd(): Promise<void> {
  const store = new WatcherStore();
  const rl = createRL();

  try {
    console.log('\nCreate a new watcher');
    console.log('─'.repeat(40));

    const name = await ask(rl, 'Name: ');
    if (!name) { console.log('Aborted.'); return; }

    // Conditions
    const conditions: Condition[] = [];
    let addMore = true;

    while (addMore) {
      console.log(`\nCondition types: rsi, price, funding_rate, position_status, has_position`);
      const type = await ask(rl, 'Condition type: ');

      switch (type) {
        case 'rsi': {
          const symbol = (await ask(rl, '  Symbol (e.g. SOL): ')).toUpperCase();
          const timeframe = await ask(rl, `  Timeframe (${VALID_INTERVALS.join(', ')}): `) || '15m';
          const opVal = await ask(rl, '  Condition (e.g. >70, <30): ');
          const match = opVal.match(/^([><])(\d+(?:\.\d+)?)$/);
          if (!match) { console.log('  Invalid condition format.'); continue; }
          conditions.push({ type: 'rsi', symbol, timeframe, op: match[1] as '>' | '<', value: parseFloat(match[2]) });
          break;
        }
        case 'price': {
          const symbol = (await ask(rl, '  Symbol (e.g. SOL): ')).toUpperCase();
          const opVal = await ask(rl, '  Condition (e.g. >100, <80): ');
          const match = opVal.match(/^([><])(\d+(?:\.\d+)?)$/);
          if (!match) { console.log('  Invalid condition format.'); continue; }
          conditions.push({ type: 'price', symbol, op: match[1] as '>' | '<', value: parseFloat(match[2]) });
          break;
        }
        case 'funding_rate': {
          const symbol = (await ask(rl, '  Symbol (e.g. SOL): ')).toUpperCase();
          const opVal = await ask(rl, '  Condition (e.g. >0.01, <-0.005): ');
          const match = opVal.match(/^([><])(-?\d+(?:\.\d+)?)$/);
          if (!match) { console.log('  Invalid condition format.'); continue; }
          conditions.push({ type: 'funding_rate', symbol, op: match[1] as '>' | '<', value: parseFloat(match[2]) });
          break;
        }
        case 'position_status': {
          const pool = await ask(rl, '  Pool address: ');
          const status = await ask(rl, '  Status (in_range / out_of_range): ') as 'in_range' | 'out_of_range';
          conditions.push({ type: 'position_status', pool, status });
          break;
        }
        case 'has_position': {
          const protocol = await ask(rl, '  Protocol (pacifica / meteora): ') as 'pacifica' | 'meteora';
          const identifier = await ask(rl, `  ${protocol === 'pacifica' ? 'Symbol' : 'Pool address'}: `);
          conditions.push({ type: 'has_position', protocol, identifier });
          break;
        }
        default:
          console.log('  Unknown condition type.');
          continue;
      }

      console.log(`  Added condition #${conditions.length}`);
      const more = await ask(rl, 'Add another condition? [y/N] ');
      addMore = more.toLowerCase() === 'y';
    }

    if (conditions.length === 0) { console.log('No conditions added. Aborted.'); return; }

    // Action
    console.log('\nAction types: alert, trade, close_perp, close_lp, webhook');
    const actionType = await ask(rl, 'Action type: ');
    let action: Action;

    switch (actionType) {
      case 'alert': {
        const message = await ask(rl, '  Message (optional): ');
        action = { type: 'alert', message: message || undefined };
        break;
      }
      case 'trade': {
        const symbol = (await ask(rl, '  Symbol: ')).toUpperCase();
        const side = await ask(rl, '  Side (long/short): ') as 'long' | 'short';
        const amount = parseFloat(await ask(rl, '  Size (asset units): '));
        if (isNaN(amount) || amount <= 0) { console.log('Invalid size.'); return; }
        action = { type: 'trade', symbol, side, amount };
        break;
      }
      case 'close_perp': {
        const symbol = (await ask(rl, '  Symbol: ')).toUpperCase();
        action = { type: 'close_perp', symbol };
        break;
      }
      case 'close_lp': {
        const pool = await ask(rl, '  Pool address: ');
        action = { type: 'close_lp', pool };
        break;
      }
      case 'webhook': {
        const url = await ask(rl, '  URL: ');
        action = { type: 'webhook', url };
        break;
      }
      default:
        console.log('Unknown action type. Aborted.');
        return;
    }

    // Interval & mode
    const interval = await ask(rl, `\nPoll interval (${VALID_INTERVALS.join(', ')}): `) || '1m';
    if (!VALID_INTERVALS.includes(interval)) {
      console.log(`Invalid interval. Valid: ${VALID_INTERVALS.join(', ')}`);
      return;
    }

    const modeInput = await ask(rl, 'Mode — [o]ne-shot or [r]epeating? ');
    const mode = modeInput.startsWith('r') ? 'repeating' : 'one_shot';

    let cooldownSeconds: number | undefined;
    if (mode === 'repeating') {
      const cd = await ask(rl, 'Cooldown between triggers in seconds (default 60): ');
      cooldownSeconds = cd ? parseInt(cd, 10) : 60;
    }

    // Summary & confirm
    console.log(`\nWatcher summary:`);
    console.log(`  Name:       ${name}`);
    console.log(`  Conditions: ${conditions.length}`);
    for (const c of conditions) {
      console.log(`    - ${formatCondition(c)}`);
    }
    console.log(`  Action:     ${formatAction(action)}`);
    console.log(`  Interval:   ${interval}`);
    console.log(`  Mode:       ${mode}`);
    console.log('');

    const confirm = await ask(rl, 'Create watcher? [y/N] ');
    if (confirm.toLowerCase() !== 'y') { console.log('Aborted.'); return; }

    const watcher = store.add({ name, conditions, action, interval, mode, cooldownSeconds });
    console.log(`\nWatcher created! ID: ${watcher.id}`);
    console.log('Run `lpcli monitor run` to start the engine.\n');
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function runList(): void {
  const store = new WatcherStore();
  const watchers = store.list();

  if (watchers.length === 0) {
    console.log('\nNo watchers configured. Run `lpcli monitor add` to create one.\n');
    return;
  }

  console.log(`\nWatchers (${watchers.length}):`);
  console.log('─'.repeat(70));

  for (const w of watchers) {
    const status = w.enabled ? 'ACTIVE' : 'DISABLED';
    const triggered = w.triggerCount > 0 ? ` (triggered ${w.triggerCount}x)` : '';
    const error = w.lastError ? ` [ERR: ${w.lastError}]` : '';

    console.log(`  [${w.id}] ${w.name} — ${status}${triggered}${error}`);
    console.log(`    Conditions:`);
    for (const c of w.conditions) {
      console.log(`      ${formatCondition(c)}`);
    }
    console.log(`    Action: ${formatAction(w.action)}`);
    console.log(`    Interval: ${w.interval} | Mode: ${w.mode}`);
    if (w.lastCheckedAt) {
      console.log(`    Last checked: ${new Date(w.lastCheckedAt).toLocaleString()}`);
    }
    console.log('');
  }
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

function runRemove(args: string[]): void {
  const id = args[0];
  if (!id) {
    console.error('Usage: lpcli monitor remove <id>');
    process.exit(1);
  }

  const store = new WatcherStore();
  if (store.remove(id)) {
    console.log(`Watcher ${id} removed.`);
  } else {
    console.error(`No watcher with ID: ${id}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Run (foreground)
// ---------------------------------------------------------------------------

async function runEngine(): Promise<void> {
  const engine = new MonitorEngine({
    logFile: `${process.env.HOME ?? ''}/.lpcli/monitor.log`,
  });

  const watchers = engine.store.listEnabled();
  if (watchers.length === 0) {
    console.log('No active watchers. Run `lpcli monitor add` first.');
    return;
  }

  engine.on((event) => {
    const time = new Date(event.timestamp).toLocaleTimeString();
    const prefix = event.watcherName === '_engine' ? 'ENGINE' : event.watcherName;

    switch (event.type) {
      case 'triggered':
        console.log(`  [${time}] >>> ${prefix}: TRIGGERED <<<`);
        break;
      case 'action_executed':
        console.log(`  [${time}] ${prefix}: ${event.detail}`);
        break;
      case 'action_failed':
        console.log(`  [${time}] ${prefix}: FAILED — ${event.detail}`);
        break;
      case 'error':
        console.log(`  [${time}] ${prefix}: ERROR — ${event.detail}`);
        break;
      case 'checked':
        // Only log engine start, not every check
        if (event.watcherName === '_engine') {
          console.log(`  [${time}] ${event.detail}`);
        }
        break;
    }
  });

  console.log(`\nMonitor engine starting — ${watchers.length} active watcher(s)`);
  console.log('Press Ctrl+C to stop.\n');

  engine.start();

  // Keep alive until Ctrl+C
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      engine.stop();
      console.log('\nMonitor stopped.\n');
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Clear
// ---------------------------------------------------------------------------

function runClear(args: string[]): void {
  const autoConfirm = hasFlag(args, '--yes');
  const store = new WatcherStore();
  const count = store.list().length;

  if (count === 0) {
    console.log('No watchers to clear.');
    return;
  }

  if (!autoConfirm) {
    console.log(`This will remove all ${count} watcher(s). Use --yes to confirm.`);
    return;
  }

  store.clear();
  console.log(`Cleared ${count} watcher(s).`);
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatCondition(c: Condition): string {
  switch (c.type) {
    case 'rsi':
      return `RSI ${c.symbol} ${c.timeframe} ${c.op} ${c.value}`;
    case 'price':
      return `Price ${c.symbol} ${c.op} $${c.value}`;
    case 'funding_rate':
      return `Funding ${c.symbol} ${c.op} ${c.value}`;
    case 'position_status':
      return `Meteora pool ${c.pool.slice(0, 8)}... is ${c.status}`;
    case 'has_position':
      return `Has ${c.protocol} position: ${c.identifier}`;
  }
}

function formatAction(a: Action): string {
  switch (a.type) {
    case 'alert':
      return `Alert${a.message ? `: ${a.message}` : ''}`;
    case 'trade':
      return `Trade ${a.side.toUpperCase()} ${a.amount} ${a.symbol}`;
    case 'close_perp':
      return `Close perp ${a.symbol}`;
    case 'close_lp':
      return `Close LP ${a.pool.slice(0, 8)}...`;
    case 'webhook':
      return `Webhook → ${a.url}`;
  }
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export async function runMonitor(args: string[]): Promise<void> {
  const subcommand = args[0];

  try {
    switch (subcommand) {
      case 'add':
        await runAdd();
        break;

      case 'list':
      case 'ls':
        runList();
        break;

      case 'remove':
      case 'rm':
        runRemove(args.slice(1));
        break;

      case 'run':
      case 'start':
        await runEngine();
        break;

      case 'clear':
        runClear(args.slice(1));
        break;

      case undefined:
      case '--help':
      case '-h':
        console.log(`
lpcli monitor — automated watcher engine

Usage:
  lpcli monitor add            Create a watcher interactively
  lpcli monitor list            List all watchers
  lpcli monitor remove <id>     Remove a watcher
  lpcli monitor run             Start the engine (foreground, Ctrl+C to stop)
  lpcli monitor clear --yes     Remove all watchers

Condition types:
  rsi              RSI crosses threshold (e.g. SOL 15m > 70)
  price            Price crosses threshold (e.g. SOL > 100)
  funding_rate     Funding rate exceeds threshold
  position_status  Meteora LP in/out of range
  has_position     Check if position exists

Action types:
  alert            Log alert message
  trade            Place market order on Pacifica
  close_perp       Close Pacifica position
  close_lp         Close Meteora LP position
  webhook          POST to URL
`);
        break;

      default:
        console.error(`Unknown monitor subcommand: ${subcommand}`);
        console.error('Run `lpcli monitor --help` for usage.');
        process.exit(1);
    }
  } catch (err: unknown) {
    console.error('Monitor error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
