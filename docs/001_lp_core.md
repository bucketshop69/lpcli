# LPCLI Core Package — PRD

**Document:** Engineering PRD for `@lpcli/core`
**Author:** Bolt (Engineering)
**Date:** April 2, 2026
**Status:** Partially implemented — pool discovery ✓, positions stubs

---

## 1. Overview

`@lpcli/core` is the core SDK for LPCLI. It is a pure TypeScript library with **zero external dependencies** beyond `@meteora-ag/dlmm` and `@solana/web3.js`. It does not import MCP SDK, does not import any chat library, and does not depend on OpenClaw. Any client — CLI, MCP server, agent script — imports from `@lpcli/core`.

The package provides:
1. **Meteora REST client** — pool discovery and info from `dlmm.datapi.meteora.ag`
2. **Scoring engine** — gate, rank, and sort pools
3. **DLMM wrapper** — position operations via `@meteora-ag/dlmm@1.5.4`
4. **Position monitor** — P&L tracking, in-range detection, fee accrual
5. **Wallet service** — keypair loading, Helius priority fee estimation

---

## 2. What Works Today (Day 1 Complete)

### MeteoraClient ✅
- `getPools(params)` — fetches all pools from Meteora REST API
- `getPool(address)` — fetches single pool detail
- In-memory cache with 5-minute TTL (avoids 30 RPS API limit)
- `clearCache()` for forced refresh

### ScoringEngine ✅
- `rankPools(pools)` — gates on TVL ≥ $10K and not blacklisted, then scores
- Score = (40% fee_tvl_ratio × 100) + (30% volume/tvl × 100) + (30% log10(tvl) × 100) × momentum
- Momentum: volume_1h / (volume_24h / 24). Capped at 2.0, penalty 0.8× if < 0.5
- `getFeeYield()`, `getVolume24()`, `getFees24()` — handle variable API response shapes

### LPCLI class ✅
- `discoverPools(token?, sortBy?, limit?)` — returns ranked `ScoredPool[]`
- `getPoolInfo(address)` — returns `PoolInfo` for single pool

### Error classes ✅
- `NetworkError` — retryable (RPC timeout, connection refused)
- `TransactionError` — not retryable (insufficient balance, slippage, program error)

---

## 3. Still Todo

### DLMMService — position operations

All methods throw `Error('TODO: implement')` stubs. Implementation order:

**High priority:**
1. `openPosition(params)` — open a new LP position
   - Inputs: pool, amountX, amountY, strategy, widthBins, type
   - Strategy: `'spot' | 'bidask' | 'curve'`
   - Type: `'balanced' | 'imbalanced' | 'one_sided_x' | 'one_sided_y'`
   - Default width: `max(10, floor(50 / binStep))` bins (~50bps price coverage)
   - Uses `@meteora-ag/dlmm` SDK
   - Key question: what method returns a Transaction vs sends it directly?

2. `closePosition(position)` — withdraw 100% + claim fees
   - Combines `removeLiquidity(10000 bps)` + `claimFee()`
   - Returns withdrawn amounts, claimed fees, tx hash

3. `getPositions(walletAddress)` — all positions for a wallet
   - Returns: address, pool, status, deposited amounts, current value, P&L (best-effort), fees earned, range, current price
   - Status: `'in_range' | 'out_of_range' | 'closed'`
   - P&L: null if entry price not accessible via SDK

**Lower priority:**
4. `getPositionDetail(position)` — deep dive for single position
5. `claimFees(position)` — claim without closing
6. `addLiquidity(params)` — add to existing position
7. `swap(params)` — token swap within a pool

### WalletService

1. **Keypair loading** — base58 env var or file path (`~/.config/solana/id.json`)
2. **Helius priority fees** — `getPriorityFeeEstimate` via Helius RPC endpoint

### SDK audit

Before implementing DLMM operations, need to verify from SDK source:
- Position open method signature (is it `depositLiquidityByStrategy`?)
- `StrategyType` enum values
- Whether SDK returns a Transaction object or sends directly
- If `getUserPositions` exposes entry price for P&L

---

## 4. API Surface

### Classes

```typescript
export class MeteoraClient {
  constructor(options: MeteoraClientOptions)
  async getPools(params?): Promise<{ total, pages, data: MeteoraPoolRaw[] }>
  async getPool(address): Promise<MeteoraPoolRaw>
  clearCache(): void
}

export class WalletService {
  constructor(options: WalletOptions)
  async getBalance(): Promise<number>
  async getPriorityFee(txBase64: string): Promise<number>
}

export class DLMMService {
  constructor(options: DLMMServiceOptions)
  async openPosition(params): Promise<OpenPositionResult>
  async closePosition(position): Promise<ClosePositionResult>
  async getPositions(wallet): Promise<Position[]>
  async getPositionDetail(position): Promise<Position>
  async claimFees(position): Promise<{ claimedX, claimedY, tx }>
  async addLiquidity(params): Promise<{ addedX, addedY, tx }>
  async swap(params): Promise<{ amountOut, priceImpact, tx }>
}

export class LPCLI {
  constructor(options: LPCLIOptions)
  meteora: MeteoraClient
  wallet: WalletService
  dlmm: DLMMService
  async discoverPools(token?, sortBy?, limit?): Promise<ScoredPool[]>
  async getPoolInfo(address): Promise<PoolInfo>
}
```

### Types

```typescript
export interface MeteoraPoolRaw {
  address: string
  name: string
  token_x: { mint: string; symbol: string; decimals: number }
  token_y: { mint: string; symbol: string; decimals: number }
  pool_config: { bin_step: number; ... }
  tvl: number
  current_price: number
  apr: number
  apy: number
  has_farm: boolean
  farm_apr: number
  volume: Record<string, number>      // keys: "30m", "1h", "2h", "4h", "12h", "24h"
  fees: Record<string, number>        // same
  protocol_fees: Record<string, number> // same
  fee_tvl_ratio: number | Record<string, number> // varies by endpoint
  is_blacklisted: boolean
}

export interface ScoredPool {
  address: string
  name: string
  token_x: string
  token_y: string
  bin_step: number
  tvl: number
  volume_24h: number
  fee_tvl_ratio_24h: number
  apr: number
  score: number
  momentum: number
  has_farm: boolean
  farm_apr: number
}

export interface Position {
  address: string
  pool: string
  pool_name: string
  status: 'in_range' | 'out_of_range' | 'closed'
  deposited_x: number
  deposited_y: number
  current_value_x: number
  current_value_y: number
  pnl_usd: number | null  // best-effort, null if entry price unavailable
  fees_earned_x: number
  fees_earned_y: number
  range_low: number
  range_high: number
  current_price: number
  opened_at: number
}

export interface PoolInfo {
  address: string; name: string; token_x: string; token_y: string
  bin_step: number; active_bin: number; current_price: number
  tvl: number; volume_24h: number; fee_24h: number
  apr: number; apy: number; has_farm: boolean; farm_apr: number
}
```

---

## 5. Configuration

### Environment

```bash
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
CLUSTER=mainnet  # or devnet
PRIVATE_KEY=~/.config/solana/id.json  # or base58 string
HELIUS_API_KEY=YOUR_KEY
```

### Package exports

```
packages/core/src/
├── core.ts       # all service code (TODO: split post-hackathon)
├── index.ts      # public exports
└── tests/
    └── core.e2e.ts  # live API E2E tests
```

**Post-hackathon split:** `core.ts` → `client.ts`, `scoring.ts`, `dlmm.ts`, `positions.ts`, `wallet.ts`, `errors.ts`, `types.ts`

---

## 6. Testing

### E2E tests (live API)

```bash
pnpm --filter @lpcli/core test:e2e
```

Tests hit the real Meteora REST API. Currently passing:
- `should fetch pools from REST API` ✅
- `should filter by token query` ✅
- `should use 5-min cache` ✅
- `should clear cache manually` ✅
- `should score and rank real pools` ✅
- `should filter out blacklisted pools` ✅

**Note:** Meteora REST API returned 500/502 errors during early test runs (transient). The scoring test has an assertion `ranked.length >= 1` that can fail if the API returns empty data. This is an API reliability issue, not a code bug.

### TODO: Add position operation E2E tests

After implementing DLMM operations:
- `should open a position on devnet`
- `should close a position on devnet`
- `should return positions with P&L`
- `should claim fees without closing`

---

## 7. Dependencies

```json
{
  "@meteora-ag/dlmm": "1.5.4",
  "@solana/web3.js": "^1.95.0",
  "@coral-xyz/anchor": "^0.30.0"
}
```

**Pending:** Verify version compatibility with `pnpm ls @solana/web3.js --depth 3` and `pnpm ls @coral-xyz/anchor --depth 3`. If conflicts → add `pnpm.overrides`.

---

## 8. What this package is NOT

- It is not an MCP server. The MCP server lives in `@lpcli/mcp`.
- It does not import `@modelcontextprotocol/sdk`.
- It does not send Telegram messages.
- It does not depend on OpenClaw.
- It does not use axios (native `fetch` only, Node 18+).

The package boundary is intentional. `@lpcli/core` is a pure Solana/Meteora library. Chat and agent integration layers live upstream.
