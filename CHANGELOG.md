# Changelog

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
