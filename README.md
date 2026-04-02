# LPCLI

Manage Meteora DLMM liquidity positions from your terminal, Telegram, or an autonomous AI agent — using the same tools.

Built on top of [Open Wallet Standard](https://github.com/open-wallet-standard/core). Private keys never leave your machine.

---

## Why

Managing DLMM positions today means clicking through Meteora's web UI for every operation — finding pools manually, opening positions one at a time, checking P&L by navigating back to the dashboard. It doesn't scale to 10 positions. It can't be automated. It can't be used by an AI agent.

LPCLI wraps every LP operation into callable tools that work from a terminal command, a Telegram message, or a programmatic SDK call. Same operations, three interfaces.

---

## Quick start

```bash
npm install -g lpcli
lpcli init
lpcli discover SOL-USDC
```

```
┌─────────────┬──────────┬─────────┬───────┐
│ Pool        │ Fee APR  │ TVL     │ Score │
├─────────────┼──────────┼─────────┼───────┤
│ SOL-USDC #1 │ 182%     │ $2.4M   │ 92    │
│ SOL-USDC #2 │ 156%     │ $1.8M   │ 87    │
│ SOL-USDC #3 │ 94%      │ $3.1M   │ 85    │
└─────────────┴──────────┴─────────┴───────┘
```

```bash
lpcli open <pool_address> --amount 5 --strategy spot
lpcli positions
lpcli close <position_address>
```

From install to first LP position in under 2 minutes. No browser, no web app.

---

## Wallet security via OWS

LPCLI uses [Open Wallet Standard](https://openwallet.sh) for transaction signing. Your private keys are encrypted at rest and decrypted only inside an isolated signing process. LPCLI — and any agent using it — never sees raw key material.

```
Agent / CLI / LPCLI
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

Setup:

```bash
# Install OWS
curl -fsSL https://openwallet.sh/install.sh | bash

# Create a wallet
ows wallet create --name "lpcli"

# LPCLI uses it automatically
lpcli init   # detects OWS wallet
```

For local development and testing, LPCLI also supports raw Solana keypair files as a fallback (`~/.config/solana/id.json`).

---

## Three interfaces, one SDK

### Terminal

```bash
lpcli discover SOL --sort fee_yield --top 5
lpcli pool <address>
lpcli open <pool> --amount 3 --strategy spot
lpcli positions
lpcli close <position>
lpcli claim <position>
lpcli swap <pool> --amount 1 --token SOL
```

No LLM. No network dependencies beyond Solana RPC and Meteora's REST API.

### Chat (Telegram)

```bash
lpcli connect openclaw     # wire into OpenClaw gateway
lpcli connect telegram     # or run a direct Telegram bot
```

Then message your bot:

```
You: what are the best SOL pools right now?
Bot: Top 3 SOL DLMM pools:
     1. SOL-USDC  | 182% APR | Score: 92
     2. SOL-USDT  | 156% APR | Score: 87
     3. SOL-JitoSOL | 94% APR | Score: 85

You: open 5 SOL spot on the first one
Bot: Position opened.
     Range: $68.50 - $71.20
     Deposited: 5 SOL + 342.5 USDC
     Tx: 4xK7...mQ9f

You: how are my positions?
Bot: SOL-USDC    | IN RANGE  | +$18.40 | 0.12 SOL fees
     SOL-JitoSOL | OUT       | -$4.20  | 0.03 SOL fees

You: rebalance the out-of-range one
Bot: Rebalanced SOL-JitoSOL.
     Claimed: 0.03 SOL
     New range: centered at current price ±8 bins
```

Chat is powered by Claude Sonnet calling the same tools the CLI uses. The LLM translates natural language into tool calls — no magic.

### Agent

```typescript
import { LPCLI } from "@lpcli/core";

const lpcli = new LPCLI({
  rpcUrl: process.env.HELIUS_RPC_URL,
});

// Autonomous rebalancing — runs on a 15-minute cron
const positions = await lpcli.getPositions();

for (const pos of positions) {
  if (pos.status === "out_of_range") {
    const closed = await lpcli.closePosition(pos.address);
    await lpcli.openPosition({
      pool: pos.pool,
      amountX: closed.withdrawnX,
      amountY: closed.withdrawnY,
      strategy: "spot",
    });
  }
}
```

Agents import `@lpcli/core` directly. No MCP overhead, no chat infrastructure. The SDK is a regular TypeScript library.

---

## Pool discovery

LPCLI doesn't just wrap Meteora's SDK — it adds intelligence on top.

Most LP tools require you to already know the pool address. LPCLI's `discover` command fetches all DLMM pools, filters out blacklisted and illiquid pools, then scores and ranks them:

| Signal | Weight | Source |
|--------|--------|--------|
| Fee yield (fees / TVL) | 40% | Meteora REST API |
| Volume-to-TVL ratio | 30% | Meteora REST API |
| Log TVL (liquidity depth) | 30% | Meteora REST API |
| Momentum penalty | -20% if cooling | volume_1h vs volume_24h |

The result: "find me the best SOL pool" returns a ranked list in milliseconds. No browsing, no spreadsheets.

---

## Architecture

```
lpcli/
├── packages/
│   ├── core/          # @lpcli/core — SDK
│   ├── cli/           # @lpcli/cli  — terminal commands
│   └── mcp/           # @lpcli/mcp  — MCP server for chat
├── configs/
│   └── system-prompt.md
└── examples/
    └── agent.ts       # autonomous rebalancing agent
```

```
@lpcli/core (the product)
  │
  ├── MeteoraClient     fetch-based REST client, 5-min cache
  ├── ScoringEngine     gate → score → sort (pluggable weights)
  ├── DLMMService       position ops via @meteora-ag/dlmm
  ├── WalletService     OWS enclave signing + keypair fallback
  └── Error classes     NetworkError (retryable) / TransactionError (not)
```

```
     CLI                    MCP Server              Agent Script
      │                        │                        │
      │  lpcli discover        │  tool: discover_pools  │  lpcli.discoverPools()
      │  lpcli open            │  tool: open_position   │  lpcli.openPosition()
      │  lpcli positions       │  tool: get_positions   │  lpcli.getPositions()
      │                        │                        │
      └────────────────────────┼────────────────────────┘
                               │
                        @lpcli/core
                               │
                    ┌──────────┼──────────┐
                    ▼          ▼          ▼
              Meteora API   Solana RPC   OWS Vault
                             (Helius)    (~/.ows/)
```

---

## Design decisions

| Decision | What we chose | Why |
|----------|--------------|-----|
| CLI-first | CLI is primary, chat is opt-in via `lpcli connect` | No external system dependency on Day 1 |
| OWS for signing | Keys never leave machine, signing in isolated enclave | Agent-safe — AI can manage positions without key exposure |
| No tx retry | NetworkError retryable, TransactionError never | Retrying a failed tx could double-spend |
| Native fetch | No axios | Zero HTTP client dependencies |
| Position width | `max(10, floor(50 / binStep))` bins | ~50bps coverage regardless of bin step |
| Scoring weights | 40/30/30 fee-yield/volume/tvl | Heuristic starting point, pluggable |
| P&L best-effort | null if entry price unavailable | Don't fabricate numbers |
| No guardrails | Raw tool access, no "are you sure?" | Built for power users and autonomous agents |

---

## Setup

### Prerequisites

- Node.js 18+
- pnpm 9+
- Solana wallet (OWS recommended, keypair file as fallback)
- Helius RPC key (free tier works)

### Install from source

```bash
git clone https://github.com/bibhu/lpcli.git
cd lpcli
pnpm install
pnpm build
```

### Environment

```bash
cp .env.example .env
```

```env
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
OWS_WALLET_NAME=lpcli
# or fallback:
# PRIVATE_KEY=~/.config/solana/id.json
```

### Verify

```bash
pnpm --filter @lpcli/core test:e2e
```

This hits the live Meteora API and confirms pool discovery + scoring works.

---

## Tools

| Tool | CLI | MCP | SDK |
|------|-----|-----|-----|
| Discover pools | `lpcli discover SOL` | `discover_pools` | `lpcli.discoverPools("SOL")` |
| Pool info | `lpcli pool <addr>` | `get_pool_info` | `lpcli.getPoolInfo(addr)` |
| Open position | `lpcli open <pool>` | `open_position` | `lpcli.openPosition({...})` |
| Close position | `lpcli close <pos>` | `close_position` | `lpcli.closePosition(addr)` |
| Portfolio | `lpcli positions` | `get_positions` | `lpcli.getPositions()` |
| Claim fees | `lpcli claim <pos>` | `claim_fees` | `lpcli.claimFees(addr)` |
| Swap | `lpcli swap <pool>` | `swap` | `lpcli.swap({...})` |

---

## Competitive context

[Cuendillar](https://github.com/stdthoth/cuendillar) is the only other Meteora DLMM MCP server. It wraps raw SDK methods — you must already know the pool address, there's no scoring, no P&L tracking, no multi-channel support. LPCLI adds pool intelligence, position monitoring, CLI-first UX, and OWS wallet security on top of the same primitives.

---

## Status

- [x] Pool discovery with scoring
- [x] Meteora REST client with cache
- [x] E2E tests against live API
- [ ] Position operations (open, close, get)
- [ ] OWS wallet signing integration
- [ ] CLI commands
- [ ] MCP server
- [ ] Telegram integration

---

## License

MIT
# lpcli
