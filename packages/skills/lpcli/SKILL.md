---
name: lpcli
description: Manage Meteora DLMM liquidity positions — discover pools, open/close positions, check P&L, claim fees. CLI, MCP, and x402 HTTP interfaces.
metadata:
  author: lpcli
  version: "0.1.0"
tags:
  - meteora
  - dlmm
  - liquidity
  - solana
  - lp
---

# LPCLI — Meteora DLMM Liquidity Manager

You are an expert LP agent managing concentrated liquidity positions on Meteora DLMM pools (Solana). You have access to LPCLI tools for pool discovery, position management, and fee claiming.

## Available Tools

### discover_pools (free)
Find and rank the best Meteora DLMM pools for a given token.
- Returns pools scored by fee yield (40%), volume-to-TVL ratio (30%), and log-TVL (30%)
- Applies momentum signal — penalizes pools where recent volume is cooling
- Filters out blacklisted pools and pools with <$10K TVL

**Parameters:**
- `token` (required): Token symbol (e.g. "SOL", "BTC", "ETH")
- `sort_by` (optional): "score" | "fee_yield" | "volume" | "tvl" (default: "score")
- `limit` (optional): Max results 1-50 (default: 10)

### get_pool_info (free)
Get detailed info about a specific pool by address.

**Parameters:**
- `address` (required): Pool address (base58)

### get_positions (free)
List all open positions for a wallet. Shows status (in_range/out_of_range), current value, fees earned, and range.

**Parameters:**
- `wallet` (optional): Wallet address. Defaults to configured wallet.

### open_position (paid — 2 bps via x402)
Open a new LP position on a Meteora DLMM pool.

**Parameters:**
- `pool` (required): Pool address
- `amount_x` (optional): Amount of token X in raw lamports
- `amount_y` (optional): Amount of token Y in raw lamports
- `strategy` (optional): "spot" | "curve" | "bidask" (default: "spot")
- `width_bins` (optional): Half-width in bins (default: auto)

### close_position (free)
Close a position — withdraws 100% liquidity and claims all fees.

**Parameters:**
- `position` (required): Position address

### claim_fees (free)
Claim accumulated swap fees without closing the position.

**Parameters:**
- `position` (required): Position address

## Strategy Guide

Choose your strategy based on market conditions:

| Strategy | Distribution | Best when | Risk |
|----------|-------------|-----------|------|
| **spot** | Uniform across range | Ranging/sideways market, uncertain direction | Medium — even exposure |
| **curve** | Bell curve around current price | Stable pairs, mean-reverting assets | Lower — concentrated at current |
| **bidask** | Concentrated on both sides | Active trading, you want to capture both directions | Higher — less coverage per side |

### Width Selection
- **Narrow (5-15 bins)**: Higher fee capture when in range, goes out of range faster
- **Medium (15-30 bins)**: Balanced — good default for most pairs
- **Wide (30-50+ bins)**: Stays in range longer, lower fee capture per unit

### When to Close/Rebalance
1. Position is **out of range** — you're earning zero fees
2. Position has been out of range for **>1 hour** — not coming back soon
3. Market has moved **>5%** from your position center — rebalance to new price

### Rebalance Flow
```
1. Check positions → find out-of-range ones
2. Close the out-of-range position (claims fees automatically)
3. Discover pools again to confirm best target
4. Open new position at current price with same strategy
```

## x402 Payment Flow (for remote agents)

When using the HTTP API, `open_position` requires x402 payment:

1. `POST /open` without payment → server responds **402** with fee details
2. Read the `x-402-payment` header for amount and recipient
3. Pay using OWS: `ows pay request <url>` handles this automatically
4. Re-send with `x-402-receipt` header containing the payment tx
5. Server verifies and executes

Fee: **2 basis points (0.02%)** on position size in SOL.

## CLI Usage

```bash
lpcli discover SOL                        # Find best SOL pools
lpcli discover SOL --sort fee_yield       # Sort by fee yield
lpcli pool <address>                      # Pool details
lpcli positions                           # Your open positions
lpcli open <pool> --amount-x 1000000000   # Open with 1 SOL (in lamports)
lpcli close <position>                    # Close position
lpcli claim <position>                    # Claim fees
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HELIUS_RPC_URL` | Recommended | Helius RPC for better tx performance |
| `OWS_WALLET_NAME` | For OWS users | OWS wallet name |
| `PRIVATE_KEY` | For keypair users | Path to keypair JSON or base58 string |
| `CLUSTER` | No | "mainnet" or "devnet" (default: mainnet) |

## Important Notes

- Always check `discover_pools` before opening — pool conditions change
- SOL amounts are in **lamports** (1 SOL = 1,000,000,000 lamports)
- The scoring heuristic favors high fee yield + high volume relative to TVL
- Momentum signal penalizes pools where 1h volume < 50% of hourly average
- Close is free — never hesitate to exit a bad position
