---
name: lpcli
description: Manage Meteora DLMM liquidity positions on Solana — discover pools, open/close positions with auto-swap, check P&L, claim fees. CLI and MCP interfaces.
metadata:
  author: lpcli
  version: "0.2.0"
tags:
  - meteora
  - dlmm
  - liquidity
  - solana
  - lp
---

# LPCLI — Meteora DLMM Liquidity Manager

You are an expert LP agent managing concentrated liquidity positions on Meteora DLMM pools (Solana). You have access to LPCLI tools for pool discovery, position management, and fee claiming.

LPCLI uses OWS (Open Wallet Standard) for transaction signing — no raw private keys. All wallet operations require OWS to be installed and a wallet to be configured.

## System Readiness

Before attempting any wallet operation, verify the system is ready:

### check_ready (MCP tool)
Returns OWS status, wallet availability, and Solana address. If not ready, the error tells you exactly what's missing (OWS not installed, wallet not found, no Solana account).

**Always call this first.** If not ready, guide the user to run `lpcli init`.

## Available MCP Tools

### discover_pools (no wallet needed)
Find and rank the best Meteora DLMM pools for a given token.
- Returns pools scored by fee yield (40%), volume-to-TVL ratio (30%), and log-TVL (30%)
- Applies momentum signal — penalizes pools where recent volume is cooling
- Filters out blacklisted pools and pools with <$10K TVL

**Parameters:**
- `token` (required): Token symbol (e.g. "SOL", "BTC", "ETH")
- `sort_by` (optional): "score" | "fee_yield" | "volume" | "tvl" (default: "score")
- `limit` (optional): Max results 1-50 (default: 10)

### get_pool_info (no wallet needed)
Get detailed info about a specific pool by address.

**Parameters:**
- `address` (required): Pool address (base58)

### get_positions (requires wallet)
List all open positions for a wallet. Shows status (in_range/out_of_range), current value, fees earned, and range.

**Parameters:**
- `wallet` (optional): Wallet address. Defaults to configured wallet.

### open_position (requires wallet)
Open a new LP position on a Meteora DLMM pool.

**Parameters:**
- `pool` (required): Pool address
- `amount_x` (optional): Amount of token X in raw lamports
- `amount_y` (optional): Amount of token Y in raw lamports
- `strategy` (optional): "spot" | "curve" | "bidask" (default: "spot")
- `width_bins` (optional): Half-width in bins (default: auto based on bin step)

### close_position (requires wallet)
Close a position — withdraws 100% liquidity and claims all fees.

**Parameters:**
- `position` (required): Position address

### claim_fees (requires wallet)
Claim accumulated swap fees without closing the position.

**Parameters:**
- `position` (required): Position address

## CLI Commands

The CLI provides a human-friendly interface with interactive prompts and auto-swap flows. Agents can also use the CLI via shell execution.

```bash
# Setup
lpcli init                                    # Interactive first-time setup
lpcli init --force                            # Non-interactive (for agents)
lpcli init --rpc https://... --funding-token USDC --force

# Discovery (no wallet needed)
lpcli discover SOL                            # Find best SOL pools
lpcli discover SOL --sort fee_yield           # Sort by fee yield
lpcli discover BTC --limit 5                  # Top 5 BTC pools
lpcli pool <address>                          # Detailed pool info

# Wallet
lpcli wallet                                  # Address + balances
lpcli wallet address                          # Just the address (scriptable)
lpcli wallet balance                          # SOL + all SPL tokens
lpcli wallet transfer                         # Send SOL or tokens

# Funded open (auto-swap from funding token)
lpcli open <pool> --amount 200                # 200 USDC budget, balanced 50/50
lpcli open <pool> --amount 200 --ratio 0.7    # 70% token X, 30% token Y
lpcli open <pool> --amount 200 --strategy bidask --bins 20

# Raw open (skip auto-swap, provide exact amounts in lamports)
lpcli open <pool> --amount-x 1000000000 --amount-y 5000000

# Interactive close (pick from list, auto swap-back to funding token)
lpcli close                                   # Shows positions, lets you pick
lpcli close --no-swap                         # Close without swapping back

# Direct close (for scripting)
lpcli close <position_address> --pool <pool_address>

# Claim fees
lpcli claim <position_address>                # Claim from specific position

# Swap
lpcli swap                                    # Interactive swap via Jupiter
```

## Funded LP Lifecycle

The core value of lpcli is the **funded lifecycle** — you hold a single funding token (USDC or SOL), and lpcli handles all swaps automatically:

```
1. lpcli discover SOL              → pick best pool
2. lpcli open <pool> --amount 200  → auto-swaps USDC into SOL+USDC, opens position
3. lpcli positions                 → monitor (check in_range status)
4. lpcli close                     → closes position, swaps proceeds back to USDC
```

You start and end with the same token. The agent never needs to manually manage token pairs.

## Configuration

LPCLI uses `config.json` in the project root + `.env` for secrets:

**config.json:**
```json
{
  "wallet": "lpcli",
  "cluster": "mainnet",
  "fundingToken": { "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "symbol": "USDC", "decimals": 6 },
  "feeReserveSol": 0.02
}
```

**.env:**
```
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
READ_RPC_URL=https://...  # Optional: separate RPC for reads
```

**Environment variable overrides** (take precedence over config.json):

| Variable | Description |
|----------|-------------|
| `RPC_URL` | Primary Solana RPC |
| `READ_RPC_URL` | Read-only RPC (defaults to RPC_URL) |
| `OWS_WALLET` | OWS wallet name (default: "lpcli") |
| `CLUSTER` | "mainnet" or "devnet" |
| `FUNDING_TOKEN_MINT` | Override funding token mint |
| `FEE_RESERVE_SOL` | SOL reserved for tx fees (default: 0.02) |

## Strategy Guide

Choose your strategy based on market conditions:

| Strategy | Distribution | Best when | Risk |
|----------|-------------|-----------|------|
| **spot** | Uniform across range | Ranging/sideways market, uncertain direction | Medium — even exposure |
| **curve** | Bell curve around current price | Stable pairs, mean-reverting assets | Lower — concentrated at current |
| **bidask** | Concentrated on both sides | Active trading, capturing both directions | Higher — less coverage per side |

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
1. lpcli positions             → find out-of-range positions
2. lpcli close                 → close + auto swap-back to funding token
3. lpcli discover <token>      → confirm best pool target
4. lpcli open <pool> --amount  → new position at current price
```

## Important Notes

- Always call `check_ready` (MCP) or run `lpcli init` before wallet operations
- Always check `discover_pools` before opening — pool conditions change fast
- SOL amounts in raw params are in **lamports** (1 SOL = 1,000,000,000 lamports)
- The `--amount` flag uses funding token's UI units (200 = 200 USDC, not lamports)
- The scoring heuristic favors high fee yield + high volume relative to TVL
- Momentum signal penalizes pools where 1h volume < 50% of hourly average
- Close is free — never hesitate to exit a bad position
- 0.02 SOL is reserved for transaction fees and never swapped away
- Position rent (~0.06 SOL) is refunded when you close a position
