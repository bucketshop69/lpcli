// ============================================================================
// Config — @lpcli/core
//
// Loads agent config from config.json in the project root.
// Env vars override file values.
// ============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env file if present (Node 20.12+). Silently ignore if missing.
try { process.loadEnvFile(); } catch { /* no .env — fine */ }

// ============================================================================
// Types
// ============================================================================

export interface FundingToken {
  mint: string;
  symbol: string;
  decimals: number;
}

export interface LPCLIConfig {
  /** OWS wallet name */
  wallet: string;
  /** Solana cluster */
  cluster: 'mainnet' | 'devnet';
  /** Primary RPC URL — used for transaction sending & confirmation */
  rpcUrl: string;
  /** Read-only RPC URL — used for account reads (DLMM.create, getBalances, etc.). Defaults to rpcUrl. */
  readRpcUrl: string;
  /** Funding token for auto-swap on LP operations */
  fundingToken: FundingToken;
  /** SOL reserved for transaction fees (in SOL, e.g. 0.02). Never swapped away. */
  feeReserveSol: number;
}

// ============================================================================
// Constants
// ============================================================================

/** SOL mint address (native wrapped SOL). */
export const SOL_MINT = 'So11111111111111111111111111111111111111112';

/** Lamports per SOL. */
export const LAMPORTS_PER_SOL = 1_000_000_000;

/** Default fee reserve: 0.02 SOL. */
export const DEFAULT_FEE_RESERVE_SOL = 0.02;

/** Position account rent (~0.06 SOL). Refunded on close. Protocol constant, not configurable. */
export const POSITION_RENT_LAMPORTS = 60_000_000;

/** Convert a SOL fee reserve to lamports. */
export function feeReserveLamports(config: LPCLIConfig): number {
  return Math.floor(config.feeReserveSol * LAMPORTS_PER_SOL);
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';

const DEFAULT_FUNDING_TOKEN: FundingToken = {
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  symbol: 'USDC',
  decimals: 6,
};

// ============================================================================
// Loader
// ============================================================================

/**
 * Find config.json by walking up from cwd, then falling back to the
 * package install directory (so `lpcli` works from any cwd).
 */
function findConfigFile(): string | null {
  // 1. Walk up from cwd (original behaviour)
  let dir = process.cwd();
  const root = resolve('/');
  while (true) {
    const candidate = resolve(dir, 'config.json');
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir || dir === root) break;
    dir = parent;
  }

  // 2. Fallback: resolve relative to the package install path.
  //    The compiled config.js lives at packages/core/dist/config.js —
  //    walk up to the monorepo root and check there.
  try {
    const thisFile = fileURLToPath(import.meta.url);
    let pkgDir = dirname(thisFile);
    while (true) {
      const candidate = resolve(pkgDir, 'config.json');
      if (existsSync(candidate)) return candidate;
      const parent = resolve(pkgDir, '..');
      if (parent === pkgDir || pkgDir === root) break;
      pkgDir = parent;
    }
  } catch {
    // import.meta.url unavailable — skip fallback
  }

  return null;
}

/**
 * Load config from config.json with env var overrides.
 *
 * Priority: env var > config.json > defaults
 */
export function loadConfig(): LPCLIConfig {
  let file: Partial<LPCLIConfig> = {};

  const configPath = findConfigFile();
  if (configPath) {
    try {
      file = JSON.parse(readFileSync(configPath, 'utf-8')) as Partial<LPCLIConfig>;
    } catch {
      // Malformed config — use defaults
    }
  }

  const wallet = process.env['OWS_WALLET'] ?? file.wallet ?? 'lpcli';

  const rpcUrl =
    process.env['RPC_URL'] ||
    process.env['SOLANA_RPC_URL'] ||
    file.rpcUrl ||
    DEFAULT_RPC;

  const readRpcUrl =
    process.env['READ_RPC_URL'] ||
    (file as Record<string, unknown>)['readRpcUrl'] as string ||
    rpcUrl;

  const cluster =
    (process.env['CLUSTER'] as 'mainnet' | 'devnet') ??
    file.cluster ??
    'mainnet';

  // Funding token: env var overrides mint only, rest from config
  const fundingTokenMint = process.env['FUNDING_TOKEN_MINT'];
  let fundingToken: FundingToken;
  if (fundingTokenMint) {
    fundingToken = {
      mint: fundingTokenMint,
      symbol: process.env['FUNDING_TOKEN_SYMBOL'] ?? file.fundingToken?.symbol ?? 'UNKNOWN',
      decimals: Number(process.env['FUNDING_TOKEN_DECIMALS'] ?? file.fundingToken?.decimals ?? 9),
    };
  } else {
    fundingToken = file.fundingToken ?? DEFAULT_FUNDING_TOKEN;
  }

  const feeReserveSol = Number(
    process.env['FEE_RESERVE_SOL'] ?? file.feeReserveSol ?? DEFAULT_FEE_RESERVE_SOL,
  );

  return { wallet, cluster, rpcUrl, readRpcUrl, fundingToken, feeReserveSol };
}
