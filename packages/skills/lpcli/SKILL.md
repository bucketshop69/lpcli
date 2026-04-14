---
name: lpcli
description: Agentic DeFi platform on Solana — Meteora DLMM liquidity, Pacifica perpetuals, Jupiter swaps, RSI indicators. CLI, MCP, and ElizaOS interfaces.
metadata:
  author: lpcli
  version: "0.5.0"
tags:
  - meteora
  - dlmm
  - liquidity
  - solana
  - perps
  - pacifica
  - jupiter
  - swap
  - defi
---

# LPCLI — Agentic DeFi Platform for Solana

You are an expert DeFi agent managing liquidity positions, perpetual trades, and token swaps on Solana. You have access to LPCLI tools for Meteora DLMM, Pacifica perps, and Jupiter swaps.

LPCLI uses OWS (Open Wallet Standard) for transaction signing — no raw private keys. All wallet operations require OWS to be installed and a wallet to be configured.

## System Readiness

Before attempting any wallet operation, verify the system is ready:

### check_ready (MCP tool)
Returns OWS status, wallet availability, and Solana address. If not ready, the error tells you exactly what's missing (OWS not installed, wallet not found, no Solana account).

**Always call this first.** If not ready, guide the user to run `lpcli init`.

## Available MCP Tools

### Meteora DLMM — Liquidity

#### discover_pools (no wallet needed)
Find and rank the best Meteora DLMM pools for a given token.
- Returns pools scored by fee yield (40%), volume-to-TVL ratio (30%), and log-TVL (30%)
- Applies momentum signal — penalizes pools where recent volume is cooling
- Filters out blacklisted pools and pools with <$10K TVL

**Parameters:**
- `token` (required): Token symbol (e.g. "SOL", "BTC", "ETH")
- `sort_by` (optional): "score" | "fee_yield" | "volume" | "tvl" (default: "score")
- `limit` (optional): Max results 1-50 (default: 10)

#### get_pool_info (no wallet needed)
Get detailed info about a specific pool by address.

**Parameters:**
- `address` (required): Pool address (base58)

#### get_positions (requires wallet)
List all open positions for a wallet. Shows status (in_range/out_of_range), current value, fees earned, and range.

**Parameters:**
- `wallet` (optional): Wallet address. Defaults to configured wallet.

#### open_position (requires wallet)
Open a new LP position on a Meteora DLMM pool.

**Parameters:**
- `pool` (required): Pool address
- `amount_x` (optional): Amount of token X in raw lamports
- `amount_y` (optional): Amount of token Y in raw lamports
- `strategy` (optional): "spot" | "curve" | "bidask" (default: "spot")
- `width_bins` (optional): Half-width in bins (default: auto based on bin step)

#### close_position (requires wallet)
Close a position — withdraws 100% liquidity and claims all fees.

**Parameters:**
- `position` (required): Position address

#### claim_fees (requires wallet)
Claim accumulated swap fees without closing the position.

**Parameters:**
- `position` (required): Position address

### Pacifica Perpetuals

#### perps_list_markets (no wallet needed)
List all available Pacifica perpetual markets with prices, funding rates, 24h volume, open interest, and max leverage.

#### perps_get_account (requires wallet)
Get Pacifica perps account balance, equity, margin used, and available funds.

#### perps_get_positions (requires wallet)
List open Pacifica perps positions with live PnL, entry price, mark price, leverage, and liquidation price.

#### perps_execute_trade (requires wallet)
Place a market order on Pacifica perps. Opens a long or short position.

**Parameters:**
- `symbol` (required): Market symbol (e.g. "SOL", "BTC", "ETH")
- `side` (required): "long" | "short"
- `size` (required): Position size in base asset units
- `leverage` (optional): Leverage multiplier (default: 1)

#### perps_close_position (requires wallet)
Close an open Pacifica perps position with a reduce-only market order.

**Parameters:**
- `symbol` (required): Market symbol

#### perps_set_sl (requires wallet)
Set a stop-loss on an existing position. Triggers a reduce-only close if price hits the level.

**Parameters:**
- `symbol` (required): Market symbol
- `price` (required): Stop-loss trigger price

#### perps_set_tp (requires wallet)
Set a take-profit on an existing position. Triggers a reduce-only close if price hits the level.

**Parameters:**
- `symbol` (required): Market symbol
- `price` (required): Take-profit trigger price

#### perps_deposit (requires wallet)
Deposit USDC collateral to Pacifica perps account.

**Parameters:**
- `amount` (required): USDC amount

#### perps_withdraw (requires wallet)
Withdraw USDC collateral from Pacifica perps account.

**Parameters:**
- `amount` (required): USDC amount

## CLI Commands

### Setup
```bash
lpcli init                                    # Interactive first-time setup
lpcli init --force                            # Non-interactive (for agents)
lpcli init --rpc https://... --funding-token USDC --force
```

### Wallet
```bash
lpcli wallet                                  # Address + balances
lpcli wallet address                          # Just the address (scriptable)
lpcli wallet balance                          # SOL + all SPL tokens
lpcli wallet transfer                         # Send SOL or tokens
```

### Pool Discovery & LP Management
```bash
lpcli discover SOL                            # Find best SOL pools
lpcli discover SOL --sort fee_yield           # Sort by fee yield
lpcli discover BTC --limit 5                  # Top 5 BTC pools
lpcli pool <address>                          # Detailed pool info
lpcli positions                               # List open LP positions

# Funded open (auto-swap from funding token)
lpcli open <pool> --amount 200                # 200 USDC budget, balanced 50/50
lpcli open <pool> --amount 200 --ratio 0.7    # 70% token X, 30% token Y
lpcli open <pool> --amount 200 --strategy bidask --bins 20

# Raw open (skip auto-swap, provide exact amounts in lamports)
lpcli open <pool> --amount-x 1000000000 --amount-y 5000000

# Close (interactive pick, auto swap-back to funding token)
lpcli close                                   # Shows positions, lets you pick
lpcli close --no-swap                         # Close without swapping back
lpcli close <position_address> --pool <pool>  # Direct close (scripting)

# Claim fees
lpcli claim <position_address>
```

### Perpetuals (Pacifica)
```bash
lpcli perps markets                           # List all markets with prices/funding
lpcli perps market SOL                        # Detailed view of SOL market
lpcli perps balance                           # Account balance & margin
lpcli perps positions                         # Open positions with PnL
lpcli perps position SOL                      # Detailed single position
lpcli perps deposit 100                       # Deposit 100 USDC
lpcli perps withdraw 50                       # Withdraw 50 USDC

# Trading
lpcli perps trade SOL long 0.5                # Long 0.5 SOL
lpcli perps trade BTC short 0.01              # Short 0.01 BTC
lpcli perps close SOL                         # Close SOL position

# Limit orders
lpcli perps limit SOL long 0.5 --price 120    # Limit long at $120
lpcli perps limit SOL close --price 160       # Limit close at $160

# RSI-conditional orders
lpcli perps limit SOL long 0.5 --rsi "<30"    # Buy when RSI drops below 30
lpcli perps limit SOL close --rsi ">70"       # Close when RSI exceeds 70
lpcli perps rsi SOL                           # Check current RSI (15m default)
lpcli perps rsi BTC 1h                        # BTC RSI on 1h timeframe

# Risk management
lpcli perps sl SOL 120                        # Stop-loss at $120
lpcli perps tp SOL 160                        # Take-profit at $160

# Order management
lpcli perps cancel                            # Cancel all orders (interactive)
lpcli perps cancel SOL                        # Cancel SOL orders only
```

### Swaps (Jupiter)
```bash
lpcli swap                                    # Interactive swap via Jupiter
```

### ElizaOS Agent
```bash
lpcli eliza                                   # Guided setup: rent Nosana GPU, boot LLM, start agent
lpcli eliza --local                           # Use local Ollama instead of Nosana
lpcli eliza --model qwen3:8b                  # Specify LLM model
```

## LP Strategy Guide

| Strategy | Distribution | Best when | Risk |
|----------|-------------|-----------|------|
| **spot** | Uniform across range | Ranging/sideways market | Medium — even exposure |
| **curve** | Bell curve around current price | Stable pairs, mean-reverting | Lower — concentrated at current |
| **bidask** | Concentrated on both sides | Active trading | Higher — less coverage per side |

### Width Selection
- **Narrow (5-15 bins)**: Higher fee capture when in range, goes out of range faster
- **Medium (15-30 bins)**: Balanced — good default for most pairs
- **Wide (30-50+ bins)**: Stays in range longer, lower fee capture per unit

### Rebalance Flow
```
1. lpcli positions             → find out-of-range positions
2. lpcli close                 → close + auto swap-back to funding token
3. lpcli discover <token>      → confirm best pool target
4. lpcli open <pool> --amount  → new position at current price
```

## Perps Strategy Guide

### RSI-Based Entries
- RSI below 30 → oversold, potential long entry
- RSI above 70 → overbought, potential short entry or exit
- Combine with `--rsi` flag for automated conditional orders

### Risk Management
- Always set stop-loss on leveraged positions
- Monitor funding rates — positive funding means longs pay shorts every 8h
- Use `lpcli perps positions` to track live PnL and liquidation price
- Max leverage is 20x — use conservatively

### Perps Workflow
```
1. lpcli perps markets                    → find opportunity
2. lpcli perps rsi SOL                    → check momentum
3. lpcli perps deposit 100                → fund account
4. lpcli perps trade SOL long 0.5         → open position
5. lpcli perps sl SOL 120                 → set stop-loss
6. lpcli perps tp SOL 160                 → set take-profit
7. lpcli perps positions                  → monitor
8. lpcli perps close SOL                  → exit when done
```

## Configuration

**config.json** (project root):
```json
{
  "wallet": "lpcli",
  "cluster": "mainnet",
  "fundingToken": { "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "symbol": "USDC", "decimals": 6 },
  "feeReserveSol": 0.02
}
```

**Environment variables** (override config.json):

| Variable | Description |
|----------|-------------|
| `RPC_URL` or `HELIUS_RPC_URL` | Primary Solana RPC |
| `READ_RPC_URL` | Read-only RPC (defaults to RPC_URL) |
| `OWS_WALLET` | OWS wallet name (default: "lpcli") |
| `CLUSTER` | "mainnet" or "devnet" |
| `FUNDING_TOKEN_MINT` | Override funding token mint |
| `FEE_RESERVE_SOL` | SOL reserved for tx fees (default: 0.02) |

## Important Notes

- Always call `check_ready` (MCP) or run `lpcli init` before wallet operations
- Always check `discover_pools` before opening LP — pool conditions change fast
- SOL amounts in raw params are in **lamports** (1 SOL = 1,000,000,000 lamports)
- The `--amount` flag uses funding token's UI units (200 = 200 USDC, not lamports)
- The scoring heuristic favors high fee yield + high volume relative to TVL
- Close is free — never hesitate to exit a bad LP position
- 0.02 SOL is reserved for transaction fees and never swapped away
- Position rent (~0.06 SOL) is refunded when you close an LP position
- Perps require USDC deposited to Pacifica before trading
- Funding rates are paid every 8 hours — factor into position holding cost
