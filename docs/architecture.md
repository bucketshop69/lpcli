# LPCLI Architecture

```
lpcli/
├── packages/
│   ├── core/          # @lpcli/core — SDK (zero external deps beyond Meteora + Solana)
│   │   └── tests/     #   core.e2e.ts, wallet.unit.ts
│   ├── cli/           # @lpcli/cli  — CLI commands (lpcli discover, open, close...)
│   ├── mcp/           # @lpcli/mcp  — MCP server for AI agent tool use
│   │   └── tests/     #   mcp.e2e.ts (5 tests — handshake, tools/list, discover, pool info, edge cases)
│   ├── x402/          # @lpcli/x402 — HTTP server with x402 micropayment gating
│   │   └── tests/     #   x402.e2e.ts (13 tests — health, CORS, free endpoints, 402 gate, fee scaling, receipts)
│   └── skills/        # @lpcli/skills — Agent knowledge layer (SKILL.md files)
│       ├── tests/     #   skills.e2e.ts (16 tests — frontmatter, sections, tool docs, program addrs)
│       ├── lpcli/     #   How to use LPCLI tools, x402 flow, strategies
│       ├── meteora/   #   DLMM mechanics, bins, fees, SDK reference
│       ├── helius/    #   RPC, priority fees, tx sending
│       └── jupiter/   #   Price lookups, swaps, token verification
├── configs/
│   └── system-prompt.md
└── examples/
    └── agent.ts       # Autonomous rebalancing agent
```

## Core (@lpcli/core)

```
MeteoraClient    — REST API (dlmm.datapi.meteora.ag), 5-min cache
ScoringEngine    — gate (blacklist + TVL) → score → sort
DLMMService      — position ops via @meteora-ag/dlmm
PositionMonitor  — P&L, in-range detection, fee tracking
WalletService    — OWS or keypair backend + Helius priority fees
```

## Interfaces

```
CLI            → lpcli discover / open / close / positions
MCP Server     → lpcli-mcp (stdio) — for Claude Code, Claude Desktop, MCP clients
x402 HTTP      → lpcli-x402 (port 3402) — for remote agents with OWS wallets
Agent          → import @lpcli/core directly
Chat           → lpcli connect openclaw | telegram
```

## Agent Integration Paths

```
Local agent (trusted)     →  CLI / MCP   →  free, runs user's wallet
Remote agent (untrusted)  →  x402 HTTP   →  pays 2 bps on open_position
```

### MCP Tools (6 total)
- discover_pools, get_pool_info — free, no wallet
- get_positions, open_position, close_position, claim_fees — require wallet

### x402 Endpoints
- GET  /discover, /pool/:addr, /positions/:wallet — free
- POST /open — x402 gated (2 bps on position size in SOL)
- POST /close, /claim — free
- GET  /health — server health check

### x402 Payment Flow
1. Agent sends `POST /open` without payment
2. Server responds **402** with `x-402-payment` header (base64 JSON) and fee details
3. Agent's OWS wallet pays (via `ows pay request`)
4. Agent re-sends with `x-402-receipt` header containing payment tx
5. Server verifies receipt and executes the operation

### Skills (4 bundled)
| Skill | Teaches |
|-------|---------|
| lpcli | Tool reference, x402 flow, CLI usage, strategies |
| meteora | DLMM bins, strategies, fee mechanics, SDK, program addresses |
| helius | Priority fees, tx sending, RPC best practices |
| jupiter | Price API, swap flow, token verification |

Loadable by OpenClaw (workspace skills dir), Claude Code (MCP system prompt),
or any agent framework that reads SKILL.md files.

## E2E Test Coverage

| Suite | Tests | Command | Network |
|-------|-------|---------|---------|
| Core | 6 | `pnpm test:e2e` | Live Meteora API |
| Skills | 16 | `pnpm test:e2e:skills` | None (file validation) |
| MCP | 5 | `pnpm test:e2e:mcp` | Live Meteora API |
| x402 | 13 | `pnpm test:e2e:x402` | Live Meteora API |
| **All** | **40** | `pnpm test:e2e:all` | |
