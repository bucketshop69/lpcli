// ============================================================================
// Token Registry — @lpcli/core
//
// Resolves SPL token mint addresses to human-readable symbols/names.
// Two-layer cache: in-memory (session) + disk (~/.lpcli/tokens.json).
// On-chain resolution via Metaplex Token Metadata Program PDA.
// ============================================================================

import { Connection, PublicKey } from '@solana/web3.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

// ============================================================================
// Types
// ============================================================================

export interface TokenInfo {
  symbol: string;
  name: string;
}

// ============================================================================
// Constants
// ============================================================================

const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const CACHE_DIR = resolve(homedir(), '.lpcli');
const CACHE_FILE = resolve(CACHE_DIR, 'tokens.json');

// ============================================================================
// Metaplex metadata deserialization
// ============================================================================

/**
 * Derive the Metaplex metadata PDA for a mint.
 */
function metadataPDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID,
  );
  return pda;
}

/**
 * Deserialize name and symbol from a Metaplex metadata account.
 *
 * Layout: key(1) + updateAuthority(32) + mint(32) = 65 bytes header
 * Then:   name_len(4) + name(var) + symbol_len(4) + symbol(var) + ...
 */
function parseMetadata(data: Buffer): TokenInfo | null {
  try {
    if (data.length < 70) return null;
    const nameLen = data.readUInt32LE(65);
    if (nameLen > 200 || 69 + nameLen + 4 > data.length) return null;
    const name = data.subarray(69, 69 + nameLen).toString('utf8').replace(/\0/g, '').trim();

    const symOff = 69 + nameLen;
    const symLen = data.readUInt32LE(symOff);
    if (symLen > 50 || symOff + 4 + symLen > data.length) return null;
    const symbol = data.subarray(symOff + 4, symOff + 4 + symLen).toString('utf8').replace(/\0/g, '').trim();

    if (!symbol) return null;
    return { symbol, name };
  } catch {
    return null;
  }
}

// ============================================================================
// Disk cache
// ============================================================================

function loadDiskCache(): Map<string, TokenInfo> {
  try {
    if (!existsSync(CACHE_FILE)) return new Map();
    const raw = JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as Record<string, TokenInfo>;
    return new Map(Object.entries(raw));
  } catch {
    return new Map();
  }
}

function saveDiskCache(cache: Map<string, TokenInfo>): void {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    const obj = Object.fromEntries(cache);
    writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2));
  } catch {
    // Non-critical — disk cache failure shouldn't break anything
  }
}

// ============================================================================
// TokenRegistry
// ============================================================================

export class TokenRegistry {
  private _memory = new Map<string, TokenInfo>();
  private _disk: Map<string, TokenInfo>;
  private _connection: Connection;

  constructor(connection: Connection) {
    this._connection = connection;
    this._disk = loadDiskCache();

    // Preload disk cache into memory
    for (const [mint, info] of this._disk) {
      this._memory.set(mint, info);
    }
  }

  /**
   * Resolve token metadata for a list of mints.
   * Returns a Map<mint, TokenInfo> for all mints (resolved or fallback).
   *
   * 1. Check memory cache
   * 2. Check disk cache
   * 3. Fetch unknown mints from on-chain (batched)
   * 4. Write new entries to memory + disk
   */
  async resolve(mints: string[]): Promise<Map<string, TokenInfo>> {
    const result = new Map<string, TokenInfo>();
    const unknown: string[] = [];

    for (const mint of mints) {
      const cached = this._memory.get(mint);
      if (cached) {
        result.set(mint, cached);
      } else {
        unknown.push(mint);
      }
    }

    if (unknown.length === 0) return result;

    // Batch fetch from on-chain
    const fetched = await this._fetchOnChain(unknown);
    let diskDirty = false;

    for (const mint of unknown) {
      const info = fetched.get(mint) ?? { symbol: mint.slice(0, 6), name: mint.slice(0, 8) + '...' };
      result.set(mint, info);

      // Only cache successfully resolved tokens (not fallbacks)
      if (fetched.has(mint)) {
        this._memory.set(mint, info);
        this._disk.set(mint, info);
        diskDirty = true;
      }
    }

    if (diskDirty) {
      saveDiskCache(this._disk);
    }

    return result;
  }

  /**
   * Get a single token's info. Returns fallback if not resolvable.
   */
  async get(mint: string): Promise<TokenInfo> {
    const map = await this.resolve([mint]);
    return map.get(mint)!;
  }

  /**
   * Fetch token metadata from on-chain Metaplex accounts.
   * Batches all mints into a single getMultipleAccountsInfo call.
   */
  private async _fetchOnChain(mints: string[]): Promise<Map<string, TokenInfo>> {
    const result = new Map<string, TokenInfo>();

    try {
      const pdas = mints.map((m) => metadataPDA(new PublicKey(m)));
      const accounts = await this._connection.getMultipleAccountsInfo(pdas);

      for (let i = 0; i < mints.length; i++) {
        const acct = accounts[i];
        if (!acct?.data) continue;
        const info = parseMetadata(acct.data as Buffer);
        if (info) {
          result.set(mints[i], info);
        }
      }
    } catch {
      // RPC failure — return what we have, rest get fallbacks
    }

    return result;
  }
}
