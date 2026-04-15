// ============================================================================
// Polymarket Market Discovery — @lpcli/core
//
// Dome API (api.domeapi.io) for market discovery, pricing, and metadata.
// Not geo-restricted. All public read operations.
//
// Required env: DOME_API_KEY
// ============================================================================

// ============================================================================
// Types
// ============================================================================

export interface DomeConfig {
  /** Dome API key (from dashboard.domeapi.io) */
  apiKey: string;
  /** Base URL override (default: https://api.domeapi.io/v1) */
  baseUrl?: string;
}

export interface DomeMarketSide {
  /** Token ID for this outcome */
  id: string;
  /** Outcome label (e.g. "Yes", "No", or custom) */
  label?: string;
}

export interface DomeMarket {
  /** Market slug (URL-friendly identifier) */
  market_slug: string;
  /** Event slug (groups related markets) */
  event_slug?: string;
  /** Condition ID (used for CLOB operations) */
  condition_id: string;
  /** Human-readable title */
  title: string;
  /** Question text */
  question?: string;
  /** Market status: open, closed, resolved */
  status: string;
  /** Tags for categorization */
  tags?: string[];
  /** YES outcome token */
  side_a: DomeMarketSide;
  /** NO outcome token */
  side_b?: DomeMarketSide;
  /** Raw response fields */
  [key: string]: unknown;
}

export interface DomeMarketPrice {
  /** Token ID */
  tokenId: string;
  /** Price (0-1) */
  price: number;
}

export interface DomeSearchParams {
  /** Search by market slug */
  market_slug?: string;
  /** Search by event slug */
  event_slug?: string;
  /** Filter by tags */
  tags?: string;
  /** Filter by status */
  status?: 'open' | 'closed' | 'resolved';
  /** Max results */
  limit?: number;
}

// ============================================================================
// Client
// ============================================================================

const DEFAULT_BASE_URL = 'https://api.domeapi.io/v1';

function buildConfig(config: DomeConfig) {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  return {
    baseUrl,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
  };
}

/**
 * Search Polymarket markets via Dome API.
 */
export async function searchMarkets(
  params: DomeSearchParams,
  config: DomeConfig,
): Promise<DomeMarket[]> {
  const { baseUrl, headers } = buildConfig(config);

  const query = new URLSearchParams();
  if (params.market_slug) query.set('market_slug', params.market_slug);
  if (params.event_slug) query.set('event_slug', params.event_slug);
  if (params.tags) query.set('tags', params.tags);
  if (params.status) query.set('status', params.status);
  if (params.limit) query.set('limit', String(params.limit));

  const res = await fetch(`${baseUrl}/polymarket/markets?${query}`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Dome search failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { markets?: DomeMarket[] };
  return data.markets ?? [];
}

/**
 * Get a single market by slug.
 */
export async function getMarketBySlug(
  slug: string,
  config: DomeConfig,
): Promise<DomeMarket | null> {
  const markets = await searchMarkets({ market_slug: slug, limit: 1 }, config);
  return markets[0] ?? null;
}

/**
 * Get price for a token ID via Dome.
 * Returns price in 0-1 range.
 */
export async function getDomePrice(
  tokenId: string,
  config: DomeConfig,
): Promise<DomeMarketPrice> {
  const { baseUrl, headers } = buildConfig(config);

  const res = await fetch(
    `${baseUrl}/polymarket/market-price/${encodeURIComponent(tokenId)}`,
    { headers },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Dome price failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { price?: number };
  if (typeof data.price !== 'number') {
    throw new Error(`Dome price: unexpected response — ${JSON.stringify(data)}`);
  }

  return { tokenId, price: data.price };
}

/**
 * Resolve a market slug to token IDs and metadata.
 * Convenience wrapper that returns everything needed for trading.
 */
export async function resolveMarket(
  slug: string,
  config: DomeConfig,
): Promise<{
  market: DomeMarket;
  conditionId: string;
  yesTokenId: string;
  noTokenId: string;
}> {
  const market = await getMarketBySlug(slug, config);
  if (!market) {
    throw new Error(`No market found for slug: ${slug}`);
  }

  if (!market.side_a?.id) {
    throw new Error(`Market "${slug}" missing side_a token ID`);
  }

  return {
    market,
    conditionId: market.condition_id,
    yesTokenId: market.side_a.id,
    noTokenId: market.side_b?.id ?? '',
  };
}
