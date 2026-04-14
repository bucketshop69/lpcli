/**
 * `lpcli predict` — Polymarket prediction markets.
 *
 * Usage:
 *   lpcli predict deposit-address    Show deposit addresses for funding
 */

import {
  LPCLI,
  polymarketAuth,
  getDepositAddresses,
  getDepositAddressesDirect,
} from '@lpcli/core';
import type { PolymarketRelayConfig } from '@lpcli/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRelayConfig(): PolymarketRelayConfig | null {
  const relayUrl = process.env.POLYMARKET_RELAY_URL?.trim();
  if (!relayUrl) return null;
  return { relayUrl };
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function showDepositAddress(): Promise<void> {
  const lpcli = new LPCLI();
  const wallet = await lpcli.getWallet();
  const solanaAddress = wallet.getPublicKey().toBase58();

  console.log(`\nSolana Wallet: ${solanaAddress}`);

  const relayConfig = getRelayConfig();
  if (!relayConfig) {
    console.error('\nPOLYMARKET_RELAY_URL not set.');
    console.error('Set it to the VPS relay URL to fetch deposit addresses.');
    process.exit(1);
  }

  // Authenticate to get the derived Polygon address
  console.log('Deriving Polymarket account...');
  const auth = await polymarketAuth(wallet, relayConfig);
  console.log(`Polygon Address: ${auth.polygonAddress}`);

  // Fetch deposit addresses — try relay first, fall back to direct
  console.log('Fetching deposit addresses...\n');

  let addresses;
  try {
    addresses = await getDepositAddresses(auth.polygonAddress, relayConfig);
  } catch {
    // Relay failed — try direct Bridge API
    try {
      addresses = await getDepositAddressesDirect(auth.polygonAddress);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to fetch deposit addresses: ${msg}`);
      process.exit(1);
    }
  }

  console.log('═'.repeat(55));
  console.log('  Polymarket Deposit Addresses');
  console.log('═'.repeat(55));

  if (addresses.svm) {
    console.log(`\n  Solana (USDC)`);
    console.log(`  ${addresses.svm}`);
    console.log(`  → Send USDC on Solana, auto-bridges to USDC.e on Polygon`);
  }

  if (addresses.evm) {
    console.log(`\n  EVM (Ethereum / Polygon / Arbitrum / Base)`);
    console.log(`  ${addresses.evm}`);
  }

  if (addresses.btc) {
    console.log(`\n  Bitcoin`);
    console.log(`  ${addresses.btc}`);
  }

  // Print any other chains from raw response
  const knownKeys = new Set(['svm', 'evm', 'btc', 'polygonAddress']);
  for (const [chain, addr] of Object.entries(addresses.raw)) {
    if (!knownKeys.has(chain) && typeof addr === 'string' && addr.length > 0) {
      console.log(`\n  ${chain}`);
      console.log(`  ${addr}`);
    }
  }

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  Polygon account: ${auth.polygonAddress}`);
  console.log(`${'═'.repeat(55)}\n`);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
lpcli predict — Polymarket prediction markets

Usage:
  lpcli predict deposit-address    Show deposit addresses for funding

Environment:
  POLYMARKET_RELAY_URL             VPS relay URL for CLOB operations
`);
}

export async function runPredict(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case 'deposit-address':
      await showDepositAddress();
      break;

    case undefined:
    case '--help':
    case '-h':
      printHelp();
      break;

    default:
      console.error(`Unknown predict subcommand: ${sub}`);
      console.error('Run `lpcli predict --help` for usage.');
      process.exit(1);
  }
}
