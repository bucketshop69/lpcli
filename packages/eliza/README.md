# @lpcli/eliza

Conversational DeFi agent for Solana — powered by ElizaOS.

> **Wallet is local (OWS). Compute is decentralized (Nosana). Trading is on-chain (Solana). No centralized dependency anywhere.**

## Quick Start

```bash
# Install
npm install -g @lpcli/cli @nosana/cli

# Setup wallet (one time)
lpcli init

# Fund your wallet with SOL + NOS tokens
lpcli wallet address    # send SOL + NOS here

# Start the agent
lpcli eliza
```

That's it. `lpcli eliza` spins up an LLM on Nosana's decentralized GPU network using your wallet, then boots the conversational agent at `http://localhost:3000`.

## How It Works

```
lpcli eliza
  ├─ 1. Exports your OWS wallet for Nosana auth
  ├─ 2. Posts a GPU job → Ollama + LLM model on Nosana
  ├─ 3. Gets back a decentralized endpoint URL
  ├─ 4. Boots ElizaOS pointed at that endpoint
  └─ 5. Chat at http://localhost:3000
```

Your wallet does double duty:
- **Signs trades** on Solana (perps, swaps, LP)
- **Pays for compute** on Nosana (NOS tokens)

Same key, same wallet. No API keys, no cloud accounts.

## What You Can Do

Talk to the agent in natural language:

- "What are the best SOL pools right now?"
- "Long 0.2 SOL with 5x leverage"
- "Set a stop loss at $120"
- "Show my positions"
- "Swap 1 SOL to USDC"
- "What's the RSI for BTC?"
- "Open an LP position on the top SOL-USDC pool"

17 actions covering:
- **Perpetuals** — trade, close, stop-loss, take-profit, cancel, deposit, withdraw
- **Liquidity** — discover pools, open/close/claim LP positions
- **Swaps** — Jupiter token swaps
- **Analysis** — RSI indicators, portfolio overview

## Modes

| Mode | Command | LLM Provider | Signing |
|------|---------|-------------|---------|
| Nosana | `lpcli eliza` | Decentralized GPU (Nosana) | OWS local |
| Local | `lpcli eliza --local` | Local Ollama | OWS local |

## Options

```
--local              Use local Ollama instead of Nosana
--model <model>      LLM model (default: qwen3:8b)
--market <market>    Nosana GPU market (default: nvidia-4090)
--timeout <mins>     Job duration in minutes (default: 120)
```

## Architecture

```
@lpcli/core  ←── cli   (terminal)
             ←── mcp   (AI agents)
             ←── x402  (HTTP + payments)
             ←── eliza (conversational) ← this package
```

Same `@lpcli/core` SDK across all interfaces. The ElizaOS plugin wraps core functions as conversational actions with providers that inject portfolio state into every LLM message.

## Requirements

- **Nosana mode**: SOL + NOS tokens, `@nosana/cli` installed
- **Local mode**: [Ollama](https://ollama.com) running locally
