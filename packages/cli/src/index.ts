#!/usr/bin/env node
/**
 * LPCLI — terminal interface for Meteora DLMM
 *
 * Usage: lpcli <command> [options]
 *
 * Commands:
 *   init          First-time wallet and config setup
 *   discover      Find and rank pools for a token
 *   pool          Show pool details
 *   positions     List your open positions
 *   open          Open a new liquidity position
 *   close         Close a position and claim fees
 *   claim         Claim fees without closing
 */

import { runInit }      from './commands/init.js';
import { runMeteora }   from './commands/meteora.js';
import { runWallet }    from './commands/wallet.js';
import { runPerps }     from './commands/perps.js';
import { runPredict }   from './commands/predict.js';
import { runEliza }     from './commands/eliza.js';

// Legacy direct imports — kept for backwards compat during migration
import { runDiscover }  from './commands/discover.js';
import { runPool }      from './commands/pool.js';
import { runPositions } from './commands/positions.js';
import { runOpen }      from './commands/open.js';
import { runClose }     from './commands/close.js';
import { runClaim }     from './commands/claim.js';
import { runSwap }      from './commands/swap.js';

const [, , command, ...args] = process.argv;

async function main(): Promise<void> {
  switch (command) {
    case 'init':
      await runInit(args);
      break;

    case 'meteora':
      await runMeteora(args);
      break;

    case 'wallet':
      await runWallet(args);
      break;

    case 'perps':
      await runPerps(args);
      break;

    case 'predict':
      await runPredict(args);
      break;

    case 'eliza':
      await runEliza(args);
      break;

    // Legacy — direct Meteora commands (backwards compat)
    case 'discover':
      await runDiscover(args);
      break;
    case 'pool':
      await runPool(args);
      break;
    case 'positions':
      await runPositions(args);
      break;
    case 'open':
      await runOpen(args);
      break;
    case 'close':
      await runClose(args);
      break;
    case 'claim':
      await runClaim(args);
      break;
    case 'swap':
      await runSwap(args);
      break;

    case undefined:
    case '--help':
    case '-h':
      printHelp();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run `lpcli --help` for usage.');
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
lpcli — DeFi terminal for Meteora, Pacifica, and Polymarket

Usage:
  lpcli init                   Interactive wallet and config setup
  lpcli meteora                Meteora DLMM (discover, open, close, swap, ...)
  lpcli wallet                 Wallet operations (balance, transfer)
  lpcli perps                  Pacifica perpetuals
  lpcli predict                Polymarket prediction markets
  lpcli eliza                  Conversational DeFi agent

Quick start:
  lpcli meteora discover       Top pools by fee efficiency
  lpcli meteora discover SOL   SOL pools
  lpcli meteora open <pool>    Open a liquidity position
  lpcli meteora positions      View open positions

Run 'lpcli <command> --help' for command-specific usage.
`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
