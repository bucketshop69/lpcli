# LPCLI Architecture

```
lpcli/
├── packages/
│   ├── core/          # @lpcli/core — SDK (zero external deps beyond Meteora + Solana)
│   ├── cli/           # @lpcli/cli  — CLI commands (lpcli discover, open, close...)
│   └── mcp/           # @lpcli/mcp  — MCP server for chat interfaces
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
WalletService    — keypair loading + Helius priority fees
```

## Interfaces

```
CLI        → lpcli discover / open / close / positions
MCP Server → lpcli serve (stdio or Streamable HTTP)
Agent      → import @lpcli/core directly
Chat       → lpcli connect openclaw | telegram
```
