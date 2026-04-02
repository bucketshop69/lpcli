# DLMMService + CLI Commands — Implementation Issue

**Issue:** #003
**Author:** Bolt (Engineering)
**Date:** April 2, 2026
**Status:** Open
**Depends on:** #002 (WalletService — done)
**Completes:** Full E2E flow for hackathon

---

## Summary

Two things in one issue because they are tightly coupled for E2E testing:

1. **`DLMMService`** — implement position operations in `@lpcli/core` using `@meteora-ag/dlmm@1.5.4`
2. **CLI commands** — wire up `discover`, `pool`, `open`, `positions`, `close`, `claim` in `@lpcli/cli`
3. **`lpcli init` fix** — auto-install OWS if not present on the machine

---

## Part 1: DLMMService

File: `packages/core/src/core.ts`

Replace all `throw new Error('TODO')` stubs with real implementations using `@meteora-ag/dlmm`.

### Priority order

#### 1. `getPositions(walletAddress: string): Promise<Position[]>`

- Use `DLMM.getPositionsByUserAndLbPair` or the equivalent method that fetches all positions for a wallet
- For each position, determine:
  - `status`: compare current active bin against position's bin range → `in_range` | `out_of_range`
  - `current_value_x` / `current_value_y`: from position's token amounts
  - `fees_earned_x` / `fees_earned_y`: unclaimed fees from the position
  - `pnl_usd`: `null` if entry price not available via SDK (do not fabricate)
  - `range_low` / `range_high`: derive from bin IDs using `getPriceOfBinByBinId`
- Return `[]` (empty array) if wallet has no positions — never throw

#### 2. `openPosition(params): Promise<OpenPositionResult>`

Params:
```typescript
{
  pool: string            // pool address
  amountX?: number        // in lamports/raw units
  amountY?: number
  strategy?: 'spot' | 'bidask' | 'curve'   // default: 'spot'
  widthBins?: number      // default: max(10, floor(50 / binStep))
  type?: 'balanced' | 'imbalanced' | 'one_sided_x' | 'one_sided_y'  // default: 'balanced'
}
```

Steps:
1. Load the DLMM pool: `DLMM.create(connection, new PublicKey(params.pool))`
2. Get active bin: `dlmm.getActiveBin()`
3. Compute bin range: active bin ± widthBins
4. Build strategy using `StrategyType` enum from SDK
5. Call `dlmm.addLiquidityByStrategy(...)` or equivalent
6. Sign + send transaction using `WalletService.signTx()`
7. Return `{ position, range_low, range_high, deposited_x, deposited_y, tx }`

#### 3. `closePosition(position: string): Promise<ClosePositionResult>`

Steps:
1. Remove all liquidity: 10000 bps (100%)
2. Claim all fees
3. Sign + send (may be 1 or 2 transactions depending on SDK)
4. Return `{ withdrawn_x, withdrawn_y, claimed_fees_x, claimed_fees_y, tx }`

#### 4. `claimFees(position: string): Promise<{ claimedX, claimedY, tx }>`

- Call SDK `claimFee` on the position
- Do NOT remove liquidity

#### Lower priority (stub if needed for hackathon deadline)
- `addLiquidity` — add to existing position
- `swap` — in-pool swap
- `getPositionDetail` — deep single-position view

### SDK notes

- SDK version is `@meteora-ag/dlmm@1.5.4` — check `node_modules/@meteora-ag/dlmm` for actual method names before assuming
- Transactions: SDK likely returns `Transaction` objects — sign with `wallet.signTx()`, send with `connection.sendRawTransaction()`
- Connection: create via `new Connection(rpcUrl, 'confirmed')`
- Use `@solana/web3.js` for `PublicKey`, `Transaction`, `Connection`

---

## Part 2: CLI Commands

File: `packages/cli/src/index.ts` + new command files

### `lpcli discover <token>`

```
lpcli discover SOL
lpcli discover SOL --sort fee_yield --top 5
```

Output:
```
┌─────────────────┬──────────┬─────────┬───────┐
│ Pool            │ Fee APR  │ TVL     │ Score │
├─────────────────┼──────────┼─────────┼───────┤
│ SOL-USDC        │ 182%     │ $2.4M   │ 92    │
│ SOL-USDT        │ 156%     │ $1.8M   │ 87    │
└─────────────────┴──────────┴─────────┴───────┘
```

Calls: `lpcli.discoverPools(token, sortBy, limit)`
No wallet needed — read-only.

### `lpcli pool <address>`

Shows TVL, APR, current price, bin step, volume 24h.
Calls: `lpcli.getPoolInfo(address)`
No wallet needed.

### `lpcli positions`

```
lpcli positions
```

Output:
```
┌──────────────┬───────────┬──────────┬────────────┐
│ Pool         │ Status    │ P&L      │ Fees Earned│
├──────────────┼───────────┼──────────┼────────────┤
│ SOL-USDC     │ IN RANGE  │ +$18.40  │ 0.12 SOL   │
│ SOL-JitoSOL  │ OUT       │ -$4.20   │ 0.03 SOL   │
└──────────────┴───────────┴──────────┴────────────┘
```

Calls: `dlmm.getPositions(wallet.getPublicKey().toBase58())`
Requires wallet.

### `lpcli open <pool>`

```
lpcli open <pool_address> --amount 5 --strategy spot
lpcli open <pool_address> --amount-x 2 --amount-y 150 --strategy bidask
```

Flags:
- `--amount <sol>` — shorthand, deposits SOL equivalent (for SOL pairs)
- `--amount-x <n>` / `--amount-y <n>` — explicit token amounts
- `--strategy spot|bidask|curve` — default: spot
- `--bins <n>` — override default bin width

Requires wallet. Confirms before sending:
```
Open position on SOL-USDC?
  Strategy: spot
  Amount: 5 SOL + ~342 USDC
  Range: $68.50 - $71.20
Confirm? [y/N]
```

### `lpcli close <position>`

```
lpcli close <position_address>
```

Confirms before sending. Closes position + claims fees in one flow.

### `lpcli claim <position>`

```
lpcli claim <position_address>
```

Claims fees without closing position.

---

## Part 3: lpcli init — OWS auto-install

Update `packages/cli/src/commands/init.ts`:

When OWS is not installed and user picks option 1 (create OWS wallet):

```
OWS not installed. Installing now...
npm install -g @open-wallet-standard/core
✓ OWS installed
```

Use `execSync('npm install -g @open-wallet-standard/core', { stdio: 'inherit' })`.
If install fails → fall through to keypair option with clear error message.

---

## Config loading in commands

All commands that need wallet/RPC should call `loadConfig()` from `packages/cli/src/config.ts`. It reads `~/.lpcli/config.json` then applies env overrides. If config doesn't exist → print `"Run \`lpcli init\` first."` and exit 1.

---

## Acceptance Criteria

- [ ] `lpcli discover SOL` returns ranked pools in a table
- [ ] `lpcli pool <address>` shows pool detail
- [ ] `lpcli positions` lists wallet positions
- [ ] `lpcli open <pool> --amount 5` opens a position on devnet
- [ ] `lpcli close <position>` closes and returns withdrawn amounts
- [ ] `lpcli claim <position>` claims fees only
- [ ] `lpcli init` auto-installs OWS if missing and user picks that option
- [ ] All write commands (open/close/claim) show a confirmation prompt
- [ ] `pnpm build` passes for both `@lpcli/core` and `@lpcli/cli`

---

## Out of Scope

- MCP server (`@lpcli/mcp`) — separate issue
- Telegram integration — separate issue
- `addLiquidity` / `swap` — nice to have, stub is fine
- Rebalance flow — separate issue
- Portfolio-level analytics
