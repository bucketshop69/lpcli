// ============================================================================
// Config — @lpcli/core
//
// Loads agent config from config.json in the project root.
// Env vars override file values.
// ============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

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
  /** Helius or other RPC URL */
  rpcUrl: string;
  /** Funding token for auto-swap on LP operations */
  fundingToken: FundingToken;
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
 * Find config.json by walking up from cwd.
 * Looks for config.json in cwd, then parent dirs up to filesystem root.
 */
function findConfigFile(): string | null {
  let dir = process.cwd();
  const root = resolve('/');
  while (true) {
    const candidate = resolve(dir, 'config.json');
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir || dir === root) return null;
    dir = parent;
  }
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
    process.env['HELIUS_RPC_URL'] ||
    process.env['SOLANA_RPC_URL'] ||
    file.rpcUrl ||
    DEFAULT_RPC;

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

  return { wallet, cluster, rpcUrl, fundingToken };
}
