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
import { runDiscover }  from './commands/discover.js';
import { runPool }      from './commands/pool.js';
import { runPositions } from './commands/positions.js';
import { runOpen }      from './commands/open.js';
import { runClose }     from './commands/close.js';
import { runClaim }     from './commands/claim.js';
import { runWallet }    from './commands/wallet.js';

const [, , command, ...args] = process.argv;

async function main(): Promise<void> {
  switch (command) {
    case 'init':
      await runInit(args);
      break;

    case 'discover':
      await runDiscover(args);
      break;

    case 'pool':
      await runPool(args);
      break;

    case 'positions':
      await runPositions();
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

    case 'wallet':
      await runWallet(args);
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
lpcli — Meteora DLMM liquidity manager

Usage:
  lpcli init                   Interactive wallet and config setup
  lpcli init --wallet <name>   Non-interactive setup (for agents)
  lpcli discover <token>       Find and rank pools for a token pair
  lpcli pool <address>         Show pool details
  lpcli positions              List your open positions
  lpcli open <pool>            Open a new liquidity position
  lpcli close <position>       Close a position and claim fees
  lpcli claim <position>       Claim fees without closing
  lpcli wallet                 Show wallet address + balances
  lpcli wallet address         Just the address (scriptable)
  lpcli wallet balance         SOL + all SPL token balances
  lpcli wallet transfer        Send SOL or tokens to an address

Options:
  --help, -h                   Show this help

Environment:
  HELIUS_RPC_URL               Helius RPC endpoint
  OWS_WALLET                   OWS wallet name (default: lpcli)
  CLUSTER                      mainnet | devnet (default: mainnet)
  FUNDING_TOKEN_MINT           Override funding token mint address

Config: ./config.json (project root)
`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
