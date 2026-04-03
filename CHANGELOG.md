# Changelog

## 0.2.0 — April 3, 2026

Agent economy: x402 payments, MCP server, and skills layer. (Issue #1)

### Added

**`@lpcli/mcp`** — MCP server for AI agents
- 6 tools: `discover_pools`, `get_pool_info`, `get_positions`, `open_position`, `close_position`, `claim_fees`
- stdio transport — works with Claude Code (`claude mcp add lpcli npx @lpcli/mcp`), Claude Desktop, any MCP client
- E2E tests: 5 tests covering handshake, tools/list, live discover, pool info, edge cases

**`@lpcli/x402`** — HTTP server with x402 micropayment gating
- Free endpoints: `GET /discover`, `GET /pool/:addr`, `GET /positions/:wallet`, `POST /close`, `POST /claim`, `GET /health`
- Paid endpoint: `POST /open` — returns 402 with payment requirements, verifies `x-402-receipt` header
- Fee: 2 bps (0.02%) on position size in SOL, paid to treasury wallet
- `x-402-payment` header base64-encoded for Node HTTP compatibility
- CORS enabled for browser/agent access
- E2E tests: 13 tests covering health, CORS, free endpoints, 402 gate, fee scaling, receipt flow, error handling

**`@lpcli/skills`** — Agent knowledge layer
- `lpcli` skill — tool reference, x402 payment flow, CLI usage, strategy guide
- `meteora` skill — DLMM bins, strategies, fee mechanics, SDK reference, program addresses (adapted from sendaifun/skills)
- `helius` skill — priority fees, tx sending, RPC best practices (adapted from sendaifun/skills)
- `jupiter` skill — price API, swap flow, token verification (adapted from sendaifun/skills)
- E2E tests: 16 tests validating frontmatter, required sections, tool docs, program addresses, token mints

**OpenClaw skill** — `~/.openclaw/workspace/skills/lpcli/SKILL.md`
- Teaches OpenClaw to use `lpcli` CLI via `exec` tool
- Documents all commands, strategies, and setup instructions

**Test infrastructure**
- `pnpm test:e2e:mcp` — MCP server E2E (node:test + native stdio)
- `pnpm test:e2e:x402` — x402 server E2E (node:test + native fetch)
- `pnpm test:e2e:skills` — Skills validation E2E (node:test + fs)
- `pnpm test:e2e:all` — runs all suites sequentially (34 tests + 6 core = 40 total)

### Changed

- `docs/architecture.md` — updated with MCP, x402, skills architecture, test coverage table
- `package.json` — added root-level test:e2e:mcp, test:e2e:x402, test:e2e:skills, test:e2e:all scripts

### Fixed

- x402 server: `x-402-payment` header now base64-encoded (Node HTTP rejects raw JSON in headers)

### Branch

`feat/1-agent-economy-x402-mcp-skills` from `main`

---

## 0.1.0 — April 2, 2026

### Added

**`@lpcli/core`** — core SDK
- `MeteoraClient` — REST client for `dlmm.datapi.meteora.ag` with 5-min cache
- `ScoringEngine` — gate + score + rank pools
- `rankPools()` — pure function, testable independently
- `LPCLI` class — main entry point combining all services
- `NetworkError` / `TransactionError` — error class separation
- Helper functions: `getFeeYield()`, `getVolume24()`, `getFees24()` for variable API shapes
- Full type definitions for all Meteora REST API response shapes

**Monorepo scaffold**
- `packages/core` — `@lpcli/core`
- `packages/cli` — `@lpcli/cli` (stubs)
- `packages/mcp` — `@lpcli/mcp` (stubs)
- `docs/architecture.md` — system diagram
- `VISION.md` — product vision
- `docs/issues.md` — decision log and open issues
- `docs/001_lp_core.md` — engineering PRD

### Verified

- `pnpm install` — passes (utf-8-validate peer dep warning is non-fatal)
- `pnpm --filter @lpcli/core typecheck` — passes, zero TS errors
- `pnpm --filter @lpcli/core test:e2e` — 6/6 pass, live Meteora API
  - Pool discovery: confirmed working (SOL-USDC top pool, TVL $5M, Fee 2.15%)
  - Cache: 61ms first call, <1ms cached
  - Scoring: stable rankings across multiple runs

### Known API shapes (from live testing)

- `volume`: `Record<"30m"|"1h"|"2h"|"4h"|"12h"|"24h", number>`
- `fees`: same
- `protocol_fees`: same
- `fee_tvl_ratio`: varies — `number` (single pool) or `Record<string, number>` (pool list)

### TODO (position operations)

- `DLMMService.openPosition()` — TODO stub
- `DLMMService.closePosition()` — TODO stub
- `DLMMService.getPositions()` — TODO stub
- `WalletService.getBalance()` — TODO stub
- `WalletService.getPriorityFee()` — TODO stub
- OWS signer integration — deferred post-hackathon

### Open (unresolved)

- Hackathon name, deadline, submission criteria — Bibhu to confirm
- `@meteora-ag/dlmm` SDK source audit — pending (needed before implementing position ops)
- OpenClaw MCP integration — deferred to Day 6
