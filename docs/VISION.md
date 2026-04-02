# LPCLI — Vision

**One line:** Manage Meteora DLMM liquidity positions from Telegram, command line, or an AI agent — using the same tools.

---

## What are we building?

LPCLI is a CLI-first liquidity management tool for Meteora DLMM pools on Solana. It exposes every LP operation — discovering pools, opening positions, closing positions, checking P&L, claiming fees — as callable tools usable three ways:

**Chat** — message your Telegram bot: "find me the best SOL pools" or "open 3 SOL spot on the first one"

**Terminal** — run `lpcli discover SOL` from any terminal

**Agent** — autonomous AI agents import the SDK and call position operations on a cron

The product works without any AI. The AI layer is additive — it makes the same tools accessible via conversation.

---

## Why does this exist?

Managing DLMM positions today means: opening the Meteora web app, finding a pool manually, clicking through a UI to open a position, checking positions by navigating back to the dashboard, closing manually. It's a point-and-click workflow that no serious LP wants to repeat across 10 positions or automate with a bot.

The underlying primitives exist — Meteora's SDK is public, the RPC API is public — but there's no tool layer between a user (or agent) and those primitives. LPCLI fills that gap.

---

## What makes it different from just using Meteora's app?

**Speed.** A CLI command takes 2 seconds. A Telegram message takes 5. Opening a position from a chat command is faster than loading a web page.

**Agents.** When your own AI agent can manage LP positions, you can build automation: rebalance when positions drift out of range, compound fees automatically, alert on P&L thresholds. Cuendillar (the only existing Meteora MCP server) gives you raw SDK wrappers. LPCLI gives you ranked pools, P&L tracking, and position intelligence — the things you'd actually want an agent to act on.

**Same tools, three interfaces.** The SDK is the product. Chat, CLI, and agents all use identical underlying operations. What you build for the CLI demo works in the Telegram demo works in the agent cron job.

---

## The three layers

```
@lpcli/core        — the SDK. Pool discovery, scoring, position ops.
                     No external deps beyond Meteora + Solana.
       ↓
@lpcli/mcp        — MCP server. Exposes core tools to any MCP-compatible
                     client (OpenClaw, Claude Desktop, etc.)
       ↓
@lpcli/cli        — CLI. lpcli discover, lpcli open, lpcli close,
                     lpcli positions...
```

You can use any layer standalone. Most users start at the CLI. Agents use the core SDK directly.

---

## The key differentiator: pool intelligence

Before LPCLI, finding the right pool requires knowing the pool address or manually browsing Meteora's UI. LPCLI's pool discovery tool:

1. Fetches all DLMM pools from Meteora's REST API
2. Filters out blacklisted and illiquid pools (under $10K TVL)
3. Scores pools by fee yield (40%), volume-to-TVL ratio (30%), and log-TVL (30%)
4. Applies a momentum signal — penalizes pools where recent volume is cooling
5. Returns ranked results in milliseconds

The score is a heuristic starting point. The point is that finding the best pool for your LP strategy shouldn't require a data science degree.

---

## The key differentiator: position visibility

Most LP tools show you your position address and current range. LPCLI shows:

- Current value in USD
- Fees earned (SOL + stablecoin)
- In-range vs out-of-range status
- P&L vs entry price (best-effort)
- A health score for each position

When a position drifts out of range, the rebalance flow is one message: "rebalance the out-of-range one." The agent closes it, claims fees, and reopens it at current price without you touching anything.

---

## The architecture choice that matters: CLI-first

The original spec was OpenClaw-first with CLI as fallback. That was wrong.

If OpenClaw breaks, the chatbot dies. If the CLI works, the chatbot is a nice-to-have. Building the CLI path first means:

- Day 1 works without any external system
- The demo works even if Telegram is down
- The SDK is the source of truth, not the chat interface
- Agents can use the SDK directly without any chat infrastructure

LPCLI is a CLI tool that happens to support chat, not a chatbot that happens to have a CLI.

---

## What success looks like

A new user installs LPCLI, connects their wallet, and can open their first LP position in under 2 minutes — without a web browser, without a Google account, without leaving their terminal.

```
npm install -g lpcli
lpcli init
lpcli discover SOL-USDC
lpcli open <pool_address> --amount 5 --strategy spot
```

The same user, a month later, has an agent running a 15-minute cron that checks their positions, closes out-of-range ones, and reopens them at current price — without them touching anything.

---

## What's in scope for the hackathon

**In scope:**
- Pool discovery with scoring (the differentiator)
- Open and close positions (core execution)
- Portfolio view with P&L and status
- CLI and MCP interfaces
- Chat via Telegram

**Out of scope for hackathon:**
- Partial withdrawals (full close covers this)
- Deep position analytics
- DCA/recurring LP strategies
- Portfolio-level rebalancing across many positions

---

## The team and the product

Bibhu (Product) — decides what we're building and why  
Bolt (Engineering) — builds it and flags the uncomfortable questions

The product belongs to neither of us. It belongs to the LP who wants to manage positions from their phone while on the go, the agent developer who wants programmatic LP access, the trader who wants speed over UI. We're building the tool. The users will define what it becomes.
