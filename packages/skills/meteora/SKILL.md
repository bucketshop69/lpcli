---
name: meteora-dlmm
description: Meteora DLMM protocol knowledge — concentrated liquidity, dynamic fees, bin mechanics, strategies, and SDK reference for Solana.
metadata:
  author: lpcli
  version: "0.1.0"
tags:
  - meteora
  - dlmm
  - concentrated-liquidity
  - solana
  - defi
---

# Meteora DLMM — Protocol Knowledge

You are an expert on Meteora's DLMM (Dynamic Liquidity Market Maker) protocol on Solana. Meteora is Solana's premier liquidity layer with $2B+ TVL.

## What is DLMM?

DLMM uses **discrete bins** instead of continuous price curves. Each bin holds liquidity at a single price point. The **active bin** is where the current trading price sits — only this bin earns fees.

### Key Concepts

- **Bin**: A discrete price level. Each bin has a fixed price determined by its ID and the pool's bin step.
- **Bin Step**: The percentage price increment between adjacent bins. A bin step of 1 = 0.01% between bins. Bin step of 100 = 1%.
- **Active Bin**: The bin at the current trading price. Swaps happen here. Only positions covering this bin earn fees.
- **Position**: A range of bins where you deposit liquidity. Can span 1 to many bins.
- **Dynamic Fees**: Fees adjust based on market volatility. Higher volatility = higher fees = better for LPs.

### How Pricing Works

```
price(binId) = (1 + binStep/10000) ^ (binId - 8388608)
```

The bin ID 8388608 is the "zero point" where price = 1. Bins above = higher price, bins below = lower.

### Fee Structure

Meteora charges dynamic fees that increase with volatility:
- **Base fee**: Set per pool (typically 0.1-1%)
- **Variable fee**: Scales with recent volatility
- **Total fee** = base + variable
- LPs earn the full fee minus protocol share (typically 5-20%)

Pool creation costs ~0.022 SOL.

## Strategies

### Spot (StrategyType = 0)
Uniform distribution across all bins in range. Equal liquidity at every price point.
- Best for: Ranging markets, uncertain direction
- Tradeoff: Lower concentration = lower fees per unit, but stays in range longer

### Curve (StrategyType = 1)
Bell curve (Gaussian) centered on active bin. Most liquidity near current price.
- Best for: Stable pairs (USDC-USDT), mean-reverting assets
- Tradeoff: High fee capture near current price, but quickly goes out of range if price moves

### BidAsk (StrategyType = 2)
Concentrated on both sides of active bin. Like a market maker's order book.
- Best for: Active trading, capturing both buy and sell flow
- Tradeoff: Less coverage per side, but captures more fees from directional trades

## When You Go Out of Range

When price moves outside your position's range:
1. You earn **zero fees** — your liquidity is idle
2. You hold 100% of the losing token (if price moved up, you hold all token Y; if down, all token X)
3. You should **close and rebalance** — there's no benefit to staying out of range

## Program Addresses

| Program | Address |
|---------|---------|
| DLMM | `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo` |
| DAMM v2 (CP-AMM) | `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` |
| Dynamic Bonding Curve | `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` |
| Dynamic Vault | `24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi` |
| Stake-for-Fee (M3M3) | `FEESngU3neckdwib9X3KWqdL7Mjmqk9XNp3uh5JbP4KP` |

## SDK Reference

Package: `@meteora-ag/dlmm`

### Key Static Methods

| Method | Description |
|--------|-------------|
| `DLMM.create(connection, poolAddress)` | Create DLMM instance for a pool |
| `DLMM.getAllLbPairPositionsByUser(connection, userPubKey)` | Get all positions across all pools |

### Key Instance Methods

| Method | Description |
|--------|-------------|
| `getActiveBin()` | Get current active bin (ID + price) |
| `initializePositionAndAddLiquidityByStrategy(params)` | Open a new position |
| `addLiquidityByStrategy(params)` | Add to existing position |
| `removeLiquidity(params)` | Withdraw (partial or full) |
| `closePosition(params)` | Terminate a position |
| `claimSwapFee(params)` | Claim accumulated fees |
| `swapQuote(amount, direction, slippage, binArrays)` | Get swap quote |
| `swap(params)` | Execute swap |

### Position Parameters

```typescript
{
  positionPubKey: PublicKey,    // New keypair for the position account
  totalXAmount: BN,            // Token X amount in lamports
  totalYAmount: BN,            // Token Y amount in lamports
  strategy: {
    minBinId: number,          // Lower bin bound
    maxBinId: number,          // Upper bin bound
    strategyType: StrategyType // Spot=0, Curve=1, BidAsk=2
  },
  user: PublicKey,             // Wallet public key
  slippage?: number            // Slippage tolerance (1 = 1%)
}
```

## Common Token Addresses

| Token | Address |
|-------|---------|
| SOL (Native Mint) | `So11111111111111111111111111111111111111112` |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| USDT | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` |

## Meteora REST API

Base URL: `https://dlmm.datapi.meteora.ag`

| Endpoint | Description |
|----------|-------------|
| `GET /pools` | List all DLMM pools (paginated) |
| `GET /pools/:address` | Single pool details |
| `GET /pools?query=SOL` | Search pools by token |

Response includes: TVL, volume (30m/1h/2h/4h/12h/24h), fees, APR, bin_step, current_price, and more.

## Troubleshooting

- **"Insufficient funds"**: Check SOL balance for both the position amount AND rent (~0.05 SOL for position account)
- **"Bin range too wide"**: Some pools limit max bin range. Try fewer bins.
- **Transaction too large**: Split into multiple transactions. The SDK handles this for removeLiquidity.
- **Stale price**: Call `refetchStates()` before operations if the pool object is cached.
