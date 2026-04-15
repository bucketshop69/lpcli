// ============================================================================
// Polymarket CLOB — @lpcli/core
//
// Order book, pricing, and market info via VPS relay.
// The relay proxies requests to clob.polymarket.com, bypassing geo-restrictions.
//
// Relay endpoints (mirrors CLOB public API under /clob/ prefix):
//   GET /clob/book?token_id=<id>              — full order book
//   GET /clob/midpoint?token_id=<id>          — midpoint price
//   GET /clob/last-trade-price?token_id=<id>  — last trade price
//   GET /clob/markets/<conditionId>           — market info (tick, rewards, etc.)
//
// Falls back to direct clob.polymarket.com if no relay configured (non-geo use).
// ============================================================================

import type { PolymarketRelayConfig } from './polymarket-auth.js';

// ============================================================================
// Types
// ============================================================================

export interface ClobConfig {
  /** VPS relay config (preferred — bypasses geo) */
  relay?: PolymarketRelayConfig;
  /** Direct CLOB base URL fallback (default: https://clob.polymarket.com) */
  directUrl?: string;
}

export interface OrderBookLevel {
  /** Price as string (e.g. "0.510") */
  price: string;
  /** Size as string (e.g. "1500.0") */
  size: string;
}

export interface OrderBook {
  /** Market identifier */
  market: string;
  /** Token ID (asset_id) */
  asset_id: string;
  /** Buy orders, sorted descending by price */
  bids: OrderBookLevel[];
  /** Sell orders, sorted ascending by price */
  asks: OrderBookLevel[];
  /** Book hash */
  hash: string;
  /** Timestamp */
  timestamp: string;
}

export interface OrderBookSummary {
  /** Token ID */
  tokenId: string;
  /** Best (highest) bid price */
  bestBid: number;
  /** Best (lowest) ask price */
  bestAsk: number;
  /** Mid price: (bestBid + bestAsk) / 2 */
  midPrice: number;
  /** Spread in dollars: bestAsk - bestBid */
  spread: number;
  /** Total bid depth (sum of all bid sizes) */
  bidDepth: number;
  /** Total ask depth (sum of all ask sizes) */
  askDepth: number;
  /** Number of bid levels */
  bidLevels: number;
  /** Number of ask levels */
  askLevels: number;
  /** Timestamp of snapshot */
  timestamp: number;
}

export interface ClobRewardsRate {
  rewards_daily_rate?: number;
  [key: string]: unknown;
}

export interface ClobRewardsConfig {
  /** Maximum spread to qualify for rewards (e.g. 0.025 = 2.5 cents) */
  max_spread?: number;
  /** Minimum order size in shares */
  min_size?: number;
  /** Reward rates */
  rates?: ClobRewardsRate[];
}

export interface ClobMarketToken {
  /** Token ID */
  token_id: string;
  /** Outcome label (e.g. "Yes", "No") */
  outcome: string;
}

export interface ClobMarketInfo {
  /** Condition ID */
  condition_id: string;
  /** Question text */
  question: string;
  /** Minimum tick size (e.g. "0.01") */
  minimum_tick_size: string;
  /** Whether this is a neg_risk (multi-outcome) market */
  neg_risk: boolean;
  /** Whether market is active */
  active: boolean;
  /** Whether market accepts orders */
  accepting_orders: boolean;
  /** Token definitions */
  tokens: ClobMarketToken[];
  /** Rewards configuration (if eligible) */
  rewards?: ClobRewardsConfig;
  /** Raw fields */
  [key: string]: unknown;
}

// ============================================================================
// Internal — URL resolution
// ============================================================================

const DEFAULT_CLOB_URL = 'https://clob.polymarket.com';

/**
 * Build the base URL for CLOB requests.
 * Relay: relayUrl + /clob   (e.g. https://vps.example.com/clob)
 * Direct: clob.polymarket.com (fallback)
 */
function getBaseUrl(config?: ClobConfig): string {
  if (config?.relay?.relayUrl) {
    return `${config.relay.relayUrl.replace(/\/$/, '')}/clob`;
  }
  return (config?.directUrl ?? DEFAULT_CLOB_URL).replace(/\/$/, '');
}

/**
 * Build ClobConfig from env if not provided.
 * Uses POLYMARKET_RELAY_URL when set.
 */
export function clobConfigFromEnv(): ClobConfig {
  const relayUrl = process.env.POLYMARKET_RELAY_URL?.trim();
  if (relayUrl) {
    return { relay: { relayUrl } };
  }
  return {};
}

// ============================================================================
// Order Book
// ============================================================================

/**
 * Fetch full order book for a token.
 */
export async function getOrderBook(
  tokenId: string,
  config?: ClobConfig,
): Promise<OrderBook> {
  const base = getBaseUrl(config);
  const res = await fetch(`${base}/book?token_id=${encodeURIComponent(tokenId)}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`CLOB book failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<OrderBook>;
}

/**
 * Fetch order book and compute summary (best bid/ask, mid, spread, depth).
 */
export async function getOrderBookSummary(
  tokenId: string,
  config?: ClobConfig,
): Promise<OrderBookSummary> {
  const book = await getOrderBook(tokenId, config);
  return summarizeBook(tokenId, book);
}

/**
 * Compute summary from a raw order book.
 */
export function summarizeBook(tokenId: string, book: OrderBook): OrderBookSummary {
  // Sort bids descending, asks ascending (CLOB may return unsorted for neg_risk)
  const bids = [...(book.bids || [])].sort(
    (a, b) => parseFloat(b.price) - parseFloat(a.price),
  );
  const asks = [...(book.asks || [])].sort(
    (a, b) => parseFloat(a.price) - parseFloat(b.price),
  );

  const bestBid = bids.length > 0 ? parseFloat(bids[0].price) : 0;
  const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) : 1;
  const midPrice = (bestBid + bestAsk) / 2;
  const spread = bestAsk - bestBid;

  const bidDepth = bids.reduce((sum, l) => sum + parseFloat(l.size), 0);
  const askDepth = asks.reduce((sum, l) => sum + parseFloat(l.size), 0);

  return {
    tokenId,
    bestBid,
    bestAsk,
    midPrice,
    spread,
    bidDepth,
    askDepth,
    bidLevels: bids.length,
    askLevels: asks.length,
    timestamp: Date.now(),
  };
}

// ============================================================================
// Price
// ============================================================================

/**
 * Fetch midpoint price for a token.
 */
export async function getMidpoint(
  tokenId: string,
  config?: ClobConfig,
): Promise<number> {
  const base = getBaseUrl(config);
  const res = await fetch(`${base}/midpoint?token_id=${encodeURIComponent(tokenId)}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`CLOB midpoint failed (${res.status}): ${body}`);
  }
  const data = await res.json() as { mid?: string };
  return parseFloat(data.mid ?? '0');
}

/**
 * Fetch last trade price for a token.
 */
export async function getLastTradePrice(
  tokenId: string,
  config?: ClobConfig,
): Promise<number> {
  const base = getBaseUrl(config);
  const res = await fetch(
    `${base}/last-trade-price?token_id=${encodeURIComponent(tokenId)}`,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`CLOB last-trade-price failed (${res.status}): ${body}`);
  }
  const data = await res.json() as { price?: string };
  return parseFloat(data.price ?? '0');
}

// ============================================================================
// Market Info
// ============================================================================

/**
 * Fetch market info by condition ID.
 * Returns tick size, neg_risk, active status, rewards config, tokens.
 */
export async function getClobMarketInfo(
  conditionId: string,
  config?: ClobConfig,
): Promise<ClobMarketInfo> {
  const base = getBaseUrl(config);
  const res = await fetch(`${base}/markets/${encodeURIComponent(conditionId)}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`CLOB market info failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<ClobMarketInfo>;
}
