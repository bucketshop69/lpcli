// ============================================================================
// Meteora REST Client — @lpcli/core
// ============================================================================

import type { MeteoraPoolRaw, MeteoraClientOptions } from './types.js';
import { NetworkError } from './errors.js';

const METEORA_BASE = {
  mainnet: 'https://dlmm.datapi.meteora.ag',
  devnet: 'https://dlmm-api.devnet.meteora.ag',
};

export class MeteoraClient {
  private cache: Map<string, { data: unknown; expiry: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(private options: MeteoraClientOptions) {}

  private baseUrl(): string {
    return METEORA_BASE[this.options.cluster];
  }

  private async fetch<T>(path: string, useCache = true): Promise<T> {
    const cacheKey = path;
    const cached = this.cache.get(cacheKey);

    if (useCache && cached && cached.expiry > Date.now()) {
      return cached.data as T;
    }

    const url = `${this.baseUrl()}${path}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new NetworkError(`Meteora API error: ${response.status} ${response.statusText} — ${url}`);
    }

    const data = (await response.json()) as T;

    if (useCache) {
      this.cache.set(cacheKey, { data, expiry: Date.now() + this.CACHE_TTL });
    }

    return data;
  }

  /**
   * Fetch all pools from Meteora REST API.
   * Response shape confirmed from: https://dlmm.datapi.meteora.ag/pair/all
   */
  async getPools(params?: {
    page?: number;
    pageSize?: number;
    query?: string;
    sortBy?: string;
    filterBy?: string;
  }): Promise<{ total: number; pages: number; data: MeteoraPoolRaw[] }> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('page_size', String(params.pageSize));
    if (params?.query) qs.set('query', params.query);
    if (params?.sortBy) qs.set('sort_by', params.sortBy);
    if (params?.filterBy) qs.set('filter_by', params.filterBy);

    const path = `/pools${qs.size > 0 ? `?${qs.toString()}` : ''}`;
    return this.fetch(path);
  }

  /**
   * Fetch a single pool by address.
   */
  async getPool(address: string): Promise<MeteoraPoolRaw> {
    return this.fetch(`/pools/${address}`);
  }

  /**
   * Invalidate the cache (force fresh fetch).
   */
  clearCache(): void {
    this.cache.clear();
  }
}
