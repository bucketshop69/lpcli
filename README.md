# LPCLI

Terminal-first agentic DeFi platform for Solana — one SDK for liquidity provision, perps, swaps, and prediction markets, with MCP and conversational AI interfaces. Optional privacy via [MagicBlock Private Ephemeral Rollups](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/api-reference/per/introduction).

Built on [Open Wallet Standard](https://github.com/open-wallet-standard/core). Private keys never leave your machine.

---

## Quick start

```bash
git clone https://github.com/bucketshop69/lpcli.git
cd lpcli
pnpm install
pnpm build
```

Create a wallet and configure:

```bash
node packages/cli/dist/index.js init
```

Start using:

```bash
# Chat-first TUI (autocomplete, command history, guided flows)
node packages/tui/dist/App.js

# Discover pools
node packages/cli/dist/index.js discover SOL

# Check perps markets
node packages/cli/dist/index.js perps markets

# Start the conversational agent
node packages/cli/dist/index.js eliza
```

Or link globally for convenience:

```bash
pnpm --filter @lpcli/cli link --global
lpcli discover SOL
```

---

## What it does

### Meteora DLMM — Liquidity Provision

Discover, score, and manage concentrated liquidity positions. Auto-swap from a single funding token, monitor P&L, claim fees, rebalance.

```bash
lpcli discover SOL                            # Ranked pools by fee yield + volume
lpcli open <pool> --amount 200 --strategy spot
lpcli positions                               # Live P&L, in/out of range
lpcli close                                   # Interactive close + swap-back
```

### Pacific — Perpetuals Trading

Market and limit orders, stop-loss/take-profit, RSI-conditional entries, up to 20x leverage.

```bash
lpcli perps markets                           # Prices, funding rates, volume
lpcli perps trade SOL long 0.5                # Market order
lpcli perps sl SOL 120                        # Stop-loss
lpcli perps tp SOL 160                        # Take-profit
lpcli perps limit SOL long 0.5 --rsi "<30"    # Buy when RSI drops below 30
lpcli perps rsi SOL                           # Current RSI indicator
lpcli perps balance                           # Account equity and margin
lpcli perps deposit 100                       # Deposit USDC
lpcli perps withdraw 50                       # Withdraw USDC
lpcli perps cancel SOL                        # Cancel orders
```

### Monitor — Watcher Engine

Run multiple watchers concurrently — RSI, price, funding rate, pool APR. Conditions are evaluated on candle-synced intervals and trigger actions (alert, trade, close, webhook).

```bash
lpcli monitor add                             # Interactive watcher creation
lpcli monitor list                            # Active watchers + status
lpcli monitor run                             # Start the watcher engine
lpcli monitor remove <id>                     # Remove a watcher
lpcli monitor clear                           # Remove all watchers
```

### Jupiter — Token Swaps

```bash
lpcli swap                                    # Interactive swap via Jupiter
```

### Private Transfers & LP — MagicBlock PERs

Optional privacy for transfers and Meteora positions via [MagicBlock Private Ephemeral Rollups](https://www.magicblock.gg). TEE-powered execution breaks the on-chain link between wallets.

```bash
lpcli transfer --private                      # Private SPL transfer via PER
```

In the TUI, the Meteora open flow asks **"public or private?"** at the end. If private:

1. A burner wallet is auto-created (via OWS, transparent to user)
2. Funding token is transferred to burner through PER (no on-chain link)
3. Position is opened from burner wallet
4. On close, proceeds swap back to funding token and return to main via PER

```
MAIN wallet ──deposit──▶ PER (TEE) ──withdraw──▶ BURNER wallet ──▶ Meteora LP
                         invisible                 can't trace back
```

```bash
# TUI commands
/transfer <addr> <amt> --private              # Private transfer
/private fund <amount>                        # Fund burner via PER
/private balance                              # Check PER + burner balances
/private health                               # MagicBlock API status
/meteora discover → open → ... → private      # Private LP position
/meteora positions                            # Shows main + burner positions
/meteora close <pos>                          # Auto-detects burner, returns via PER
```

### Wallet

```bash
lpcli wallet address                          # Show wallet address
lpcli wallet balance                          # SOL + SPL token balances
lpcli transfer                                # Interactive token transfer
```

### Polymarket — Prediction Markets

```bash
lpcli predict deposit-address                 # Deposit addresses for funding
```

### ElizaOS — Conversational Agent

One command to rent a GPU on Nosana's decentralized network, boot an LLM, and start a conversational DeFi agent with full trading capabilities.

```bash
lpcli eliza                                   # Guided: pick GPU, auto-fund, boot LLM
lpcli eliza --local                           # Use local Ollama instead
```

Wallet is local (OWS). Compute is decentralized (Nosana). Trading is on-chain (Solana).

---

## Wallet security via OWS

LPCLI uses [Open Wallet Standard](https://openwallet.sh) for transaction signing. Your private keys are encrypted at rest and decrypted only inside an isolated signing process. LPCLI — and any agent using it — never sees raw key material.

```
Agent / CLI / ElizaOS
       │
       │  Builds transaction
       ▼
┌─────────────────────┐
│    OWS Enclave      │
│                     │
│  1. Decrypt key     │
│  2. Sign tx         │
│  3. Wipe key        │
│  4. Return signature│
│                     │
│  Keys stay here.    │
│  LPCLI never        │
│  touches them.      │
└─────────────────────┘
```

---

## Architecture

```
lpcli/
├── packages/
│   ├── core/          # @lpcli/core    — SDK (all DeFi logic + MagicBlock PERs)
│   ├── cli/           # @lpcli/cli     — terminal commands
│   ├── tui/           # @lpcli/tui     — Ink-based chat-first REPL
│   ├── monitor/       # @lpcli/monitor — watcher engine (RSI, price, funding, APR)
│   ├── mcp/           # @lpcli/mcp     — MCP server for AI agents
│   ├── eliza/         # @lpcli/eliza   — ElizaOS plugin (17 actions)
│   ├── x402/          # @lpcli/x402    — HTTP + payment layer
│   └── skills/        # @lpcli/skills  — agent skill definitions
```

```
@lpcli/core    ←── cli     (terminal)
               ←── tui     (chat-first REPL)
               ←── monitor (watcher engine)
               ←── mcp     (AI agents via MCP)
               ←── eliza   (conversational agent)
               ←── x402    (HTTP + payments)
```

All interfaces share one SDK. A trade placed from the terminal uses the same code path as one triggered by the AI agent.

---

## MCP Tools

LPCLI exposes 16 MCP tools for AI agent integration:

| Tool | Description | Wallet |
|------|-------------|--------|
| `check_ready` | System status — OWS, wallet, address | No |
| `discover_pools` | Find and rank Meteora DLMM pools | No |
| `get_pool_info` | Pool details by address | No |
| `get_positions` | Open LP positions with P&L | Yes |
| `open_position` | Open LP position | Yes |
| `close_position` | Close LP + claim fees | Yes |
| `claim_fees` | Claim fees without closing | Yes |
| `perps_list_markets` | Perps markets, prices, funding | No |
| `perps_get_account` | Account balance and margin | Yes |
| `perps_get_positions` | Open perps positions with PnL | Yes |
| `perps_execute_trade` | Place market order | Yes |
| `perps_close_position` | Close perps position | Yes |
| `perps_set_sl` | Set stop-loss | Yes |
| `perps_set_tp` | Set take-profit | Yes |
| `perps_deposit` | Deposit USDC to pacific | Yes |
| `perps_withdraw` | Withdraw USDC from pacific | Yes |

---

## Configuration

```bash
cp .env.example .env
```

```env
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
OWS_WALLET=lpcli
```

| Variable | Description |
|----------|-------------|
| `HELIUS_RPC_URL` or `RPC_URL` | Primary Solana RPC |
| `READ_RPC_URL` | Read-only RPC (defaults to RPC_URL) |
| `OWS_WALLET` | OWS wallet name (default: "lpcli") |
| `CLUSTER` | "mainnet" or "devnet" |
| `FUNDING_TOKEN_MINT` | Override funding token mint |
| `FEE_RESERVE_SOL` | SOL reserved for tx fees (default: 0.02) |

---

## Prerequisites

- Node.js 18+
- pnpm 9+
- Solana wallet via OWS
- Helius RPC key (free tier works)

---

## License

MIT
