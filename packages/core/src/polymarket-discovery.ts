import { NetworkError } from './errors.js';

export interface PolymarketMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  liquidity: number;
  volume: number;
  outcomes: string[];
  outcomePrices: number[];
  active: boolean;
  closed: boolean;
}

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';

/**
 * Discovers active markets on Polymarket using the Gamma API.
 * This client provides search and filtering capabilities for agents.
 */
export class PolymarketDiscovery {
  /**
   * Search for active markets by query string.
   */
  async searchMarkets(query: string, limit = 10): Promise<PolymarketMarket[]> {
    const url = new URL(`${GAMMA_API_BASE}/markets`);
    url.searchParams.set('active', 'true');
    url.searchParams.set('closed', 'false');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('search', query);

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new NetworkError(`Polymarket Gamma API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return data.map((m: any) => ({
      id: m.id,
      question: m.question,
      conditionId: m.conditionId,
      slug: m.slug,
      liquidity: parseFloat(m.liquidity || '0'),
      volume: parseFloat(m.volume || '0'),
      outcomes: JSON.parse(m.outcomes || '[]'),
      outcomePrices: JSON.parse(m.outcomePrices || '[]').map(Number),
      active: m.active,
      closed: m.closed,
    }));
  }

  /**
   * Get trending markets based on volume and liquidity.
   */
  async getTrendingMarkets(limit = 10): Promise<PolymarketMarket[]> {
      const url = new URL(`${GAMMA_API_BASE}/markets`);
      url.searchParams.set('active', 'true');
      url.searchParams.set('closed', 'false');
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('sort', 'volume');
      url.searchParams.set('order', 'desc');

      const res = await fetch(url.toString());
      if (!res.ok) {
        throw new NetworkError(`Polymarket Gamma API error: ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      return data.map((m: any) => ({
        id: m.id,
        question: m.question,
        conditionId: m.conditionId,
        slug: m.slug,
        liquidity: parseFloat(m.liquidity || '0'),
        volume: parseFloat(m.volume || '0'),
        outcomes: JSON.parse(m.outcomes || '[]'),
        outcomePrices: JSON.parse(m.outcomePrices || '[]').map(Number),
        active: m.active,
        closed: m.closed,
      }));
  }
}
