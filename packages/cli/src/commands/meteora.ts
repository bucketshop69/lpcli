/**
 * `lpcli meteora` — Meteora DLMM command namespace.
 *
 * Usage:
 *   lpcli meteora discover [query]     Find and rank pools
 *   lpcli meteora pool <address>       Show pool details
 *   lpcli meteora positions            List your open positions
 *   lpcli meteora open <pool>          Open a new liquidity position
 *   lpcli meteora close                Close a position and claim fees
 *   lpcli meteora claim <position>     Claim fees without closing
 *   lpcli meteora swap                 Swap tokens via Jupiter Ultra API
 */

import { runDiscover } from './discover.js';
import { runPool } from './pool.js';
import { runPositions } from './positions.js';
import { runOpen } from './open.js';
import { runClose } from './close.js';
import { runClaim } from './claim.js';
import { runSwap } from './swap.js';

export async function runMeteora(args: string[]): Promise<void> {
  const [subcommand, ...subArgs] = args;

  switch (subcommand) {
    case 'discover':
      await runDiscover(subArgs);
      break;

    case 'pool':
      await runPool(subArgs);
      break;

    case 'positions':
      await runPositions(subArgs);
      break;

    case 'open':
      await runOpen(subArgs);
      break;

    case 'close':
      await runClose(subArgs);
      break;

    case 'claim':
      await runClaim(subArgs);
      break;

    case 'swap':
      await runSwap(subArgs);
      break;

    case undefined:
    case '--help':
    case '-h':
      printMeteoraHelp();
      break;

    default:
      console.error(`Unknown meteora command: ${subcommand}`);
      console.error('Run `lpcli meteora --help` for usage.');
      process.exit(1);
  }
}

function printMeteoraHelp(): void {
  console.log(`
lpcli meteora — Meteora DLMM liquidity management

Usage:
  lpcli meteora discover [query]       Find and rank pools (interactive)
  lpcli meteora pool <address>         Show pool details
  lpcli meteora positions              List your open positions
  lpcli meteora open <pool>            Open a new liquidity position
  lpcli meteora close                  Close a position and claim fees
  lpcli meteora claim <position>       Claim fees without closing
  lpcli meteora swap                   Swap tokens via Jupiter Ultra API

Examples:
  lpcli meteora discover               Top pools by fee efficiency
  lpcli meteora discover SOL           SOL pools
  lpcli meteora discover sol-usdc      Specific pair
  lpcli meteora discover <mint>        By token mint address
  lpcli meteora discover <pool_addr>   By pool address
`);
}
