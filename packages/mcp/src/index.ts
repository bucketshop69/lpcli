#!/usr/bin/env node
/**
 * @lpcli/mcp — MCP server exposing Meteora DLMM tools to AI agents.
 *
 * Transports:
 *   stdio (default) — for Claude Code: `claude mcp add lpcli npx @lpcli/mcp`
 *
 * Tools exposed:
 *   discover_pools   — find and rank DLMM pools (free, no wallet needed)
 *   get_pool_info    — detailed pool info (free, no wallet needed)
 *   get_positions    — list positions with P&L (requires wallet)
 *   open_position    — open a new LP position (requires wallet)
 *   close_position   — close position + claim fees (requires wallet)
 *   claim_fees       — claim fees without closing (requires wallet)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { LPCLI } from '@lpcli/core';

// ---------------------------------------------------------------------------
// LPCLI instance — lazily initialised with wallet when needed
// ---------------------------------------------------------------------------

function createLpcli(): LPCLI {
  return new LPCLI();
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'lpcli',
  version: '0.1.0',
});

// ── discover_pools ──────────────────────────────────────────────────────────

server.tool(
  'discover_pools',
  'Find and rank the best Meteora DLMM pools for a token. Returns scored pools sorted by fee yield, volume, and TVL. No wallet needed.',
  {
    token: z.string().describe('Token symbol to search for (e.g. "SOL", "BTC", "ETH")'),
    sort_by: z.enum(['score', 'fee_yield', 'volume', 'tvl']).default('score').describe('Sort key'),
    limit: z.number().int().min(1).max(50).default(10).describe('Max results'),
  },
  async ({ token, sort_by, limit }) => {
    const lpcli = createLpcli();
    const pools = await lpcli.discoverPools(token, sort_by, limit);

    if (pools.length === 0) {
      return { content: [{ type: 'text', text: `No pools found for "${token}".` }] };
    }

    const text = pools.map((p, i) =>
      `${i + 1}. ${p.name}\n` +
      `   Address: ${p.address}\n` +
      `   TVL: $${p.tvl.toLocaleString()} | Vol 24h: $${p.volume_24h.toLocaleString()} | APR: ${(p.apr * 100).toFixed(1)}%\n` +
      `   Bin step: ${p.bin_step} | Score: ${p.score.toFixed(1)} | Momentum: ${p.momentum.toFixed(2)}\n` +
      (p.has_farm ? `   Farm APR: ${(p.farm_apr * 100).toFixed(1)}%\n` : '')
    ).join('\n');

    return { content: [{ type: 'text', text }] };
  }
);

// ── get_pool_info ───────────────────────────────────────────────────────────

server.tool(
  'get_pool_info',
  'Get detailed information about a specific Meteora DLMM pool. No wallet needed.',
  {
    address: z.string().describe('Pool address (base58)'),
  },
  async ({ address }) => {
    const lpcli = createLpcli();
    const pool = await lpcli.getPoolInfo(address);

    const text =
      `Pool: ${pool.name}\n` +
      `Address: ${pool.address}\n` +
      `Tokens: ${pool.token_x} / ${pool.token_y}\n` +
      `Bin step: ${pool.bin_step}\n` +
      `Current price: ${pool.current_price}\n` +
      `TVL: $${pool.tvl.toLocaleString()}\n` +
      `Volume 24h: $${pool.volume_24h.toLocaleString()}\n` +
      `Fees 24h: $${pool.fee_24h.toLocaleString()}\n` +
      `APR: ${(pool.apr * 100).toFixed(1)}% | APY: ${(pool.apy * 100).toFixed(1)}%\n` +
      (pool.has_farm ? `Farm APR: ${(pool.farm_apr * 100).toFixed(1)}%` : 'No farm');

    return { content: [{ type: 'text', text }] };
  }
);

// ── get_positions ───────────────────────────────────────────────────────────

server.tool(
  'get_positions',
  'List all open Meteora DLMM positions for the configured wallet. Shows status, value, fees earned, and range.',
  {
    wallet: z.string().optional().describe('Wallet address (base58). Defaults to configured wallet.'),
  },
  async ({ wallet }) => {
    const lpcli = createLpcli();
    const w = await lpcli.getWallet();
    const walletAddr = wallet ?? w.getPublicKey().toBase58();
    const positions = await lpcli.dlmm!.getPositions(walletAddr);

    if (positions.length === 0) {
      return { content: [{ type: 'text', text: 'No open positions found.' }] };
    }

    const text = positions.map((p, i) =>
      `${i + 1}. ${p.pool_name} [${p.status.toUpperCase()}]\n` +
      `   Position: ${p.address}\n` +
      `   Pool: ${p.pool}\n` +
      `   Value: X=${p.current_value_x} Y=${p.current_value_y}\n` +
      `   Fees earned: X=${p.fees_earned_x} Y=${p.fees_earned_y}\n` +
      `   Range: ${p.range_low.toFixed(6)} — ${p.range_high.toFixed(6)} (price: ${p.current_price.toFixed(6)})\n` +
      (p.pnl_usd !== null ? `   P&L: $${p.pnl_usd.toFixed(2)}\n` : '')
    ).join('\n');

    return { content: [{ type: 'text', text }] };
  }
);

// ── open_position ───────────────────────────────────────────────────────────

server.tool(
  'open_position',
  'Open a new liquidity position on a Meteora DLMM pool. Requires wallet. Strategies: spot (uniform), curve (bell curve around price), bidask (concentrated on both sides).',
  {
    pool: z.string().describe('Pool address (base58)'),
    amount_x: z.number().optional().describe('Amount of token X in raw lamports'),
    amount_y: z.number().optional().describe('Amount of token Y in raw lamports'),
    strategy: z.enum(['spot', 'curve', 'bidask']).default('spot').describe('Distribution strategy'),
    width_bins: z.number().int().optional().describe('Half-width in bins (default: auto based on bin step)'),
  },
  async ({ pool, amount_x, amount_y, strategy, width_bins }) => {
    const lpcli = createLpcli();
    await lpcli.getWallet();

    const result = await lpcli.dlmm!.openPosition({
      pool,
      amountX: amount_x,
      amountY: amount_y,
      strategy,
      widthBins: width_bins,
    });

    const text =
      `Position opened successfully!\n` +
      `Position: ${result.position}\n` +
      `Range: ${result.range_low.toFixed(6)} — ${result.range_high.toFixed(6)}\n` +
      `Deposited: X=${result.deposited_x} Y=${result.deposited_y}\n` +
      `Transaction: ${result.tx}`;

    return { content: [{ type: 'text', text }] };
  }
);

// ── close_position ──────────────────────────────────────────────────────────

server.tool(
  'close_position',
  'Close a liquidity position — withdraws 100% liquidity and claims all fees. Requires wallet.',
  {
    position: z.string().describe('Position address (base58)'),
  },
  async ({ position }) => {
    const lpcli = createLpcli();
    await lpcli.getWallet();

    const result = await lpcli.dlmm!.closePosition(position);

    const text =
      `Position closed!\n` +
      `Withdrawn: X=${result.withdrawn_x} Y=${result.withdrawn_y}\n` +
      `Fees claimed: X=${result.claimed_fees_x} Y=${result.claimed_fees_y}\n` +
      `Transaction: ${result.tx}`;

    return { content: [{ type: 'text', text }] };
  }
);

// ── claim_fees ──────────────────────────────────────────────────────────────

server.tool(
  'claim_fees',
  'Claim accumulated swap fees from a position without closing it. Requires wallet.',
  {
    position: z.string().describe('Position address (base58)'),
  },
  async ({ position }) => {
    const lpcli = createLpcli();
    await lpcli.getWallet();

    const result = await lpcli.dlmm!.claimFees(position);

    if (!result.tx) {
      return { content: [{ type: 'text', text: 'No fees to claim on this position.' }] };
    }

    const text =
      `Fees claimed!\n` +
      `Claimed: X=${result.claimedX} Y=${result.claimedY}\n` +
      `Transaction: ${result.tx}`;

    return { content: [{ type: 'text', text }] };
  }
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error('MCP server error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
