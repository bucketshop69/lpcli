---
name: helius-solana
description: Helius Solana infrastructure — RPC best practices, priority fees, transaction sending, and balance queries for LP operations.
metadata:
  author: lpcli
  version: "0.1.0"
tags:
  - helius
  - solana
  - rpc
  - priority-fees
  - transactions
---

# Helius — Solana Infrastructure for LP Operations

You have knowledge of Helius, Solana's leading RPC and API provider. This skill focuses on what matters for LP operations: sending transactions reliably, getting priority fees right, and checking balances.

## Why Helius for LP

Standard Solana RPC (`api.mainnet-beta.solana.com`) is rate-limited and slow. For LP operations (opening/closing positions), you need:
- **Priority fee estimation** — underpaying = tx dropped, overpaying = wasted SOL
- **Reliable tx sending** — Helius Sender routes through Jito for better landing rates
- **Fast balance checks** — know your SOL/token balances before opening positions

## Priority Fees

Every Solana transaction needs a priority fee to land reliably. Helius provides `getPriorityFeeEstimate`:

```typescript
const response = await fetch(HELIUS_RPC_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getPriorityFeeEstimate',
    params: [{
      transaction: txBase64,  // base64-encoded serialized tx
      options: { priorityLevel: 'Medium' }
    }]
  })
});
```

**Priority levels:** Min, Low, Medium, High, VeryHigh, UnsafeMax

**For LP operations:**
- `Medium` — default for opening/closing positions
- `High` — use when market is volatile and you need fast execution
- `VeryHigh` — emergency close of a losing position

## Transaction Sending Best Practices

### Always do:
- Include `skipPreflight: true` when using Helius Sender
- Include a priority fee via `ComputeBudgetProgram.setComputeUnitPrice`
- Use `getPriorityFeeEstimate` — never hardcode fees
- Retry with exponential backoff on transient failures

### Never do:
- Send to `api.mainnet-beta.solana.com` for important txs — use Helius
- Hardcode priority fees — they change constantly
- Skip preflight without a good reason (Helius Sender is the exception)

## Balance Checks

Before opening a position, verify:
1. **SOL balance** — need enough for position + rent (~0.05 SOL) + priority fee
2. **Token balances** — if depositing token X or Y, check you have enough

```typescript
// SOL balance
const balance = await connection.getBalance(walletPubKey);

// Token balance (SPL)
const tokenAccounts = await connection.getTokenAccountsByOwner(walletPubKey, {
  mint: new PublicKey(tokenMint)
});
```

## RPC Endpoints

| Plan | Endpoint | Rate Limit |
|------|----------|------------|
| Free | `https://mainnet.helius-rpc.com/?api-key=YOUR_KEY` | 10 req/s |
| Developer ($49/mo) | Same pattern | 50 req/s |
| Business ($499/mo) | Same pattern | 200 req/s |

Get a key: https://dashboard.helius.dev

## Commitment Levels

| Level | Use when |
|-------|---------|
| `processed` | Quick reads (balance checks, price lookups) |
| `confirmed` | Default for most operations |
| `finalized` | Critical operations (closing large positions) |

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| 429 Too Many Requests | Rate limited | Exponential backoff, wait 1-5s |
| Transaction simulation failed | Insufficient balance or bad params | Check balances, re-simulate |
| Blockhash expired | Transaction took too long | Re-fetch blockhash, re-sign, re-send |
| Transaction too large | Too many instructions | Split into multiple txs |

## Explorer Links

Use Orb for transaction/account links:
- Transaction: `https://orbmarkets.io/tx/{signature}`
- Account: `https://orbmarkets.io/address/{address}`
