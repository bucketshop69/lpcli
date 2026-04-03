---
name: jupiter-for-lp
description: Jupiter API knowledge for LP operations — price lookups, token swaps for pair acquisition, and token metadata verification.
metadata:
  author: lpcli
  version: "0.1.0"
tags:
  - jupiter
  - swap
  - price
  - solana
  - defi
---

# Jupiter — Price & Swap for LP Operations

You have knowledge of Jupiter, Solana's leading DEX aggregator. This skill focuses on what matters for LP: checking token prices and swapping to get the right token pair before depositing into a DLMM pool.

## When to Use Jupiter (as an LP agent)

1. **Price check before LP** — Is the current pool price aligned with Jupiter's market price? A large deviation could mean the pool is stale or being arbitraged.
2. **Swap to acquire tokens** — You have SOL but need USDC for a SOL-USDC pool. Swap half via Jupiter first.
3. **Token verification** — Is this token legitimate? Check Jupiter's verification status before LPing.

## Price API

**Base URL:** `https://api.jup.ag/price/v3`

```
GET /price/v3?ids={mint1},{mint2}
```

- Max 50 mints per request
- Returns price in USD with confidence level
- Tokens with unreliable pricing return `null`

**Example:**
```bash
curl "https://api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112"
```

**Use this to:**
- Verify pool price matches market before opening a position
- Calculate USD value of your position
- Detect arbitrage opportunities between pool price and market price

## Ultra Swap API

**Base URL:** `https://api.jup.ag/ultra/v1`
**Auth:** `x-api-key` header from portal.jup.ag (required)

### Swap Flow

```
1. GET  /order?inputMint=SOL&outputMint=USDC&amount=1000000000
   → returns order with unsigned transaction

2. Sign the transaction with your wallet

3. POST /execute
   { requestId, signedTransaction }
   → returns tx signature
```

### Key Parameters

| Param | Description |
|-------|-------------|
| `inputMint` | Token you're selling |
| `outputMint` | Token you're buying |
| `amount` | Amount in smallest unit (lamports for SOL) |
| `slippageBps` | Max slippage in basis points (default: 50 = 0.5%) |

### For LP Token Acquisition

Before opening an LP position on a SOL-USDC pool with the "spot" strategy, you need both tokens:

```
1. Check how much SOL you want to LP total (e.g., 10 SOL)
2. Swap half to USDC: Jupiter swap 5 SOL → USDC
3. Open position with 5 SOL (token X) + equivalent USDC (token Y)
```

For one-sided strategies (only token X or Y), no swap needed.

## Token Metadata

**Base URL:** `https://api.jup.ag/tokens/v2`

```
GET /search?query={mint_or_symbol}
```

**Key fields to check:**
- `verified` — Is the token on Jupiter's verified list?
- `organicScore` — How organic is the trading activity? Higher = better
- `audit.isSus` — Is the token flagged as suspicious?

**Before LPing into an unknown token:**
1. Check Jupiter verification status
2. Check organic score (>0.5 is reasonable)
3. Check if `isSus` is true — if so, DO NOT LP

## Rate Limits

| Volume (24h) | Requests per 10s |
|-------------|-----------------|
| $0 | 50 |
| $100K | 61 |
| $1M | 165 |

On HTTP 429: exponential backoff, wait 10s sliding window.

## Common Token Mints

| Token | Mint |
|-------|------|
| SOL | `So11111111111111111111111111111111111111112` |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| USDT | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` |
| JUP | `JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN` |

## Integration Rules

- Always use mint address as primary identifier, not symbol (symbols can collide)
- Never hardcode prices — always fetch fresh from the API
- Check `confidenceLevel` on price data — low confidence = unreliable
- Signed payloads have ~2 min TTL — don't delay between quote and execute
- Fee: 5-10 bps standard on swaps
