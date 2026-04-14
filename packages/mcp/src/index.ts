#!/usr/bin/env node
/**
 * @lpcli/mcp — MCP server exposing Meteora DLMM tools to AI agents.
 *
 * Transports:
 *   stdio (default) — for Claude Code: `claude mcp add lpcli npx @lpcli/mcp`
 *
 * Tools exposed:
 *   discover_pools       — find and rank DLMM pools (free)
 *   get_pool_info        — detailed pool info (free)
 *   get_positions        — list LP positions with P&L (wallet)
 *   open_position        — open LP position (wallet)
 *   close_position       — close LP position + claim fees (wallet)
 *   claim_fees           — claim fees without closing (wallet)
 *   perps_list_markets   — available perps markets with specs (free)
 *   perps_get_account    — perps account balance & margin (wallet)
 *   perps_get_positions  — open perps positions with PnL (wallet)
 *   perps_execute_trade  — place market order (wallet)
 *   perps_close_position — close perps position (wallet)
 *   perps_set_sl         — set stop-loss (wallet)
 *   perps_set_tp         — set take-profit (wallet)
 *   perps_deposit        — deposit USDC collateral (wallet)
 *   perps_withdraw       — withdraw USDC collateral (wallet)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  LPCLI,
  PacificaClient,
  createMarketOrder,
  closePosition as closePerpsPosition,
  cancelAllOrders,
  setPositionTPSL,
  buildDepositTransaction,
  requestWithdrawal,
  roundToLotSize,
  PACIFICA_MIN_DEPOSIT_USDC,
} from '@lpcli/core';
import type { ReadinessStatus } from '@lpcli/core';

// ---------------------------------------------------------------------------
// Singleton LPCLI — reuses DLMM cache across tool calls
// ---------------------------------------------------------------------------

let _lpcli: LPCLI | null = null;

function getLpcli(): LPCLI {
  if (!_lpcli) _lpcli = new LPCLI();
  return _lpcli;
}

/** Cached readiness — re-checked when not ready (OWS might be installed mid-session). */
let _readiness: ReadinessStatus | null = null;

async function requireWallet(): Promise<LPCLI> {
  const lpcli = getLpcli();
  if (!_readiness?.ready) {
    _readiness = await lpcli.checkReady();
  }
  if (!_readiness.ready) {
    throw new Error(`Wallet not available: ${_readiness.error}`);
  }
  return lpcli;
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'lpcli',
  version: '0.1.0',
});

// ── check_ready ────────────────────────────────────────────────────────────

server.tool(
  'check_ready',
  'Check if the system is ready to sign transactions. Returns OWS status, wallet availability, and Solana address. Call this before any wallet-requiring operation.',
  {},
  async () => {
    const lpcli = getLpcli();
    _readiness = await lpcli.checkReady();

    const text = _readiness.ready
      ? `Ready ✓\n  Wallet: ${lpcli.config.wallet}\n  Address: ${_readiness.address}\n  Cluster: ${lpcli.config.cluster}`
      : `Not ready ✗\n  ${_readiness.error}`;

    return { content: [{ type: 'text', text }] };
  }
);

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
    const lpcli = getLpcli();
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
    const lpcli = getLpcli();
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
    const lpcli = await requireWallet();
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
    const lpcli = await requireWallet();

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
    const lpcli = await requireWallet();

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
    const lpcli = await requireWallet();

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

// ===========================================================================
// Pacifica Perps Tools
// ===========================================================================

// ── perps_list_markets ─────────────────────────────────────────────────────

server.tool(
  'perps_list_markets',
  'List all available Pacifica perpetual markets with prices, funding rates, volume, and leverage. No wallet needed.',
  {
    sort_by: z.enum(['volume', 'symbol']).default('volume').describe('Sort order'),
    limit: z.number().int().min(1).max(100).default(20).describe('Max results'),
  },
  async ({ sort_by, limit }) => {
    const client = new PacificaClient();
    const [markets, prices] = await Promise.all([
      client.getMarkets(),
      client.getPrices(),
    ]);

    const priceMap = new Map(prices.map((p) => [p.symbol, p]));
    let sorted = [...markets];

    if (sort_by === 'volume') {
      sorted.sort((a, b) => {
        const volA = parseFloat(priceMap.get(a.symbol)?.volume_24h ?? '0');
        const volB = parseFloat(priceMap.get(b.symbol)?.volume_24h ?? '0');
        return volB - volA;
      });
    } else {
      sorted.sort((a, b) => a.symbol.localeCompare(b.symbol));
    }

    sorted = sorted.slice(0, limit);

    const text = sorted.map((m) => {
      const p = priceMap.get(m.symbol);
      const mark = p ? parseFloat(p.mark) : 0;
      const funding = p ? (parseFloat(p.funding) * 100).toFixed(4) : '?';
      const vol = p ? parseFloat(p.volume_24h) : 0;
      return `${m.symbol}: $${mark.toLocaleString()} | Funding: ${funding}% | Vol: $${vol.toLocaleString()} | ${m.max_leverage}x | Lot: ${m.lot_size}`;
    }).join('\n');

    return { content: [{ type: 'text', text: `Pacifica Markets (${sorted.length}):\n${text}` }] };
  }
);

// ── perps_get_account ──────────────────────────────────────────────────────

server.tool(
  'perps_get_account',
  'Get Pacifica perps account balance, equity, margin used, and available funds. Requires wallet.',
  {},
  async () => {
    const lpcli = await requireWallet();
    const wallet = await lpcli.getWallet();
    const address = wallet.getPublicKey().toBase58();
    const client = new PacificaClient();

    try {
      const info = await client.getAccountInfo(address);
      const text =
        `Pacifica Account: ${address}\n` +
        `Balance: $${parseFloat(info.balance).toFixed(2)}\n` +
        `Equity: $${parseFloat(info.account_equity).toFixed(2)}\n` +
        `Available to Spend: $${parseFloat(info.available_to_spend).toFixed(2)}\n` +
        `Available to Withdraw: $${parseFloat(info.available_to_withdraw).toFixed(2)}\n` +
        `Margin Used: $${parseFloat(info.total_margin_used).toFixed(2)}\n` +
        `Positions: ${info.positions_count} | Orders: ${info.orders_count}`;
      return { content: [{ type: 'text', text }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
        return { content: [{ type: 'text', text: `No Pacifica account found for ${address}. Deposit at least $${PACIFICA_MIN_DEPOSIT_USDC} USDC to create one.` }] };
      }
      throw err;
    }
  }
);

// ── perps_get_positions ────────────────────────────────────────────────────

server.tool(
  'perps_get_positions',
  'List open Pacifica perps positions with live PnL. Requires wallet.',
  {},
  async () => {
    const lpcli = await requireWallet();
    const wallet = await lpcli.getWallet();
    const address = wallet.getPublicKey().toBase58();
    const client = new PacificaClient();

    const [positions, prices] = await Promise.all([
      client.getPositions(address),
      client.getPrices(),
    ]);

    if (positions.length === 0) {
      return { content: [{ type: 'text', text: 'No open perps positions.' }] };
    }

    const priceMap = new Map(prices.map((p) => [p.symbol, parseFloat(p.mark)]));

    const text = positions.map((pos) => {
      const side = pos.side === 'bid' ? 'LONG' : 'SHORT';
      const size = parseFloat(pos.amount);
      const entry = parseFloat(pos.entry_price);
      const mark = priceMap.get(pos.symbol) ?? entry;
      const direction = pos.side === 'bid' ? 1 : -1;
      const pnl = (mark - entry) * size * direction;
      const pnlPct = entry > 0 && size > 0 ? (pnl / (entry * size)) * 100 : 0;
      return `${pos.symbol} ${side} ${size} | Entry: $${entry} | Mark: $${mark} | PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`;
    }).join('\n');

    return { content: [{ type: 'text', text: `Open Positions (${positions.length}):\n${text}` }] };
  }
);

// ── perps_execute_trade ────────────────────────────────────────────────────

server.tool(
  'perps_execute_trade',
  'Place a market order on Pacifica perps. Opens a long or short position. Requires wallet.',
  {
    symbol: z.string().describe('Market symbol (e.g. BTC, ETH, SOL)'),
    direction: z.enum(['long', 'short']).describe('Trade direction'),
    size: z.number().positive().describe('Position size in asset units (e.g. 0.01 BTC)'),
    slippage_percent: z.number().min(0.01).max(10).default(1).describe('Slippage tolerance %'),
  },
  async ({ symbol, direction, size, slippage_percent }) => {
    const lpcli = await requireWallet();
    const wallet = await lpcli.getWallet();
    const client = new PacificaClient();

    const result = await createMarketOrder(wallet, {
      symbol: symbol.toUpperCase(),
      side: direction === 'long' ? 'bid' : 'ask',
      amount: size,
      slippagePercent: slippage_percent,
    }, client);

    return { content: [{ type: 'text', text: `Order placed! ID: ${result.orderId}\n${direction.toUpperCase()} ${size} ${symbol.toUpperCase()}` }] };
  }
);

// ── perps_close_position ───────────────────────────────────────────────────

server.tool(
  'perps_close_position',
  'Close an open Pacifica perps position with a reduce-only market order. Requires wallet.',
  {
    symbol: z.string().describe('Market symbol of position to close (e.g. BTC, ETH, SOL)'),
  },
  async ({ symbol }) => {
    const lpcli = await requireWallet();
    const wallet = await lpcli.getWallet();
    const client = new PacificaClient();

    const result = await closePerpsPosition(wallet, symbol.toUpperCase(), client);

    if (!result) {
      return { content: [{ type: 'text', text: `No open position found for ${symbol.toUpperCase()}.` }] };
    }

    return { content: [{ type: 'text', text: `Position closed! Order ID: ${result.orderId}` }] };
  }
);

// ── perps_set_sl ───────────────────────────────────────────────────────────

server.tool(
  'perps_set_sl',
  'Set a stop-loss on an existing Pacifica perps position. Requires wallet.',
  {
    symbol: z.string().describe('Market symbol (e.g. BTC, ETH, SOL)'),
    price: z.number().positive().describe('Stop-loss trigger price'),
  },
  async ({ symbol, price }) => {
    const lpcli = await requireWallet();
    const wallet = await lpcli.getWallet();
    const client = new PacificaClient();

    await setPositionTPSL(wallet, {
      symbol: symbol.toUpperCase(),
      stopLoss: { stopPrice: price.toString() },
    }, client);

    return { content: [{ type: 'text', text: `Stop-loss set at $${price} for ${symbol.toUpperCase()}.` }] };
  }
);

// ── perps_set_tp ───────────────────────────────────────────────────────────

server.tool(
  'perps_set_tp',
  'Set a take-profit on an existing Pacifica perps position. Requires wallet.',
  {
    symbol: z.string().describe('Market symbol (e.g. BTC, ETH, SOL)'),
    price: z.number().positive().describe('Take-profit trigger price'),
  },
  async ({ symbol, price }) => {
    const lpcli = await requireWallet();
    const wallet = await lpcli.getWallet();
    const client = new PacificaClient();

    await setPositionTPSL(wallet, {
      symbol: symbol.toUpperCase(),
      takeProfit: { stopPrice: price.toString() },
    }, client);

    return { content: [{ type: 'text', text: `Take-profit set at $${price} for ${symbol.toUpperCase()}.` }] };
  }
);

// ── perps_deposit ──────────────────────────────────────────────────────────

server.tool(
  'perps_deposit',
  `Deposit USDC collateral to Pacifica. Minimum $${PACIFICA_MIN_DEPOSIT_USDC}. Requires wallet.`,
  {
    amount: z.number().min(PACIFICA_MIN_DEPOSIT_USDC).describe(`USDC amount to deposit (min $${PACIFICA_MIN_DEPOSIT_USDC})`),
  },
  async ({ amount }) => {
    const lpcli = await requireWallet();
    const wallet = await lpcli.getWallet();
    const connection = wallet.getConnection();
    const pubkey = wallet.getPublicKey();

    const tx = await buildDepositTransaction(pubkey, amount, connection);
    const signed = await wallet.signTx(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(sig, 'confirmed');

    return { content: [{ type: 'text', text: `Deposited $${amount.toFixed(2)} USDC to Pacifica.\nTx: ${sig}` }] };
  }
);

// ── perps_withdraw ─────────────────────────────────────────────────────────

server.tool(
  'perps_withdraw',
  'Withdraw USDC collateral from Pacifica. Requires wallet.',
  {
    amount: z.number().positive().describe('USDC amount to withdraw'),
  },
  async ({ amount }) => {
    const lpcli = await requireWallet();
    const wallet = await lpcli.getWallet();
    const client = new PacificaClient();

    await requestWithdrawal(wallet, amount, client);

    return { content: [{ type: 'text', text: `Withdrawal of $${amount.toFixed(2)} USDC requested. Pacifica will process it to your wallet.` }] };
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
