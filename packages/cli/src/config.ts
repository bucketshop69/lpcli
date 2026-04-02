/**
 * Config loader for LPCLI CLI.
 *
 * Config file lives at ~/.lpcli/config.json.
 * Environment variables override config file values.
 */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface LPCLIConfig {
  rpcUrl: string;
  cluster: 'mainnet' | 'devnet';
  walletBackend: 'ows' | 'keypair';
  owsWalletName?: string;
  privateKey?: string;
}

const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';
export const CONFIG_PATH = join(homedir(), '.lpcli', 'config.json');

/**
 * Load config from ~/.lpcli/config.json, then apply env overrides.
 *
 * Returns a partial config — callers should handle missing values.
 */
export function loadConfig(): Partial<LPCLIConfig> {
  let file: Partial<LPCLIConfig> = {};

  if (existsSync(CONFIG_PATH)) {
    try {
      file = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Partial<LPCLIConfig>;
    } catch {
      // Malformed config — ignore, user will get errors downstream
    }
  }

  // Env overrides take precedence over config file
  const rpcUrl =
    process.env['HELIUS_RPC_URL'] ??
    process.env['SOLANA_RPC_URL'] ??
    file.rpcUrl ??
    DEFAULT_RPC;

  const owsWalletName = process.env['OWS_WALLET_NAME'] ?? file.owsWalletName;
  const privateKey = process.env['PRIVATE_KEY'] ?? file.privateKey;

  let walletBackend = file.walletBackend;
  if (!walletBackend) {
    walletBackend = owsWalletName ? 'ows' : 'keypair';
  }

  const cluster = (process.env['CLUSTER'] as 'mainnet' | 'devnet') ?? file.cluster ?? 'mainnet';

  return {
    rpcUrl,
    cluster,
    walletBackend,
    owsWalletName,
    privateKey,
  };
}
