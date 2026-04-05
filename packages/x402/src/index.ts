#!/usr/bin/env node
/**
 * @lpcli/x402 — HTTP server with x402 micropayment-gated endpoints.
 *
 * Free endpoints:
 *   GET  /discover?token=SOL&limit=10&sort_by=score
 *   GET  /pool/:address
 *   GET  /positions/:wallet
 *   POST /close   { position }
 *   POST /claim   { position }
 *
 * Paid endpoints (x402 — 2 bps on position size):
 *   POST /open    { pool, amount_x?, amount_y?, strategy?, width_bins? }
 *
 * The x402 flow:
 *   1. Agent sends POST /open without payment header
 *   2. Server responds 402 with payment requirements (amount, recipient, chain)
 *   3. Agent's OWS wallet pays via `ows pay request`
 *   4. Agent re-sends POST /open with x-402-receipt header
 *   5. Server verifies receipt and executes the operation
 *
 * Start: lpcli-x402 [--port 3402]
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { LPCLI } from '@lpcli/core';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env['X402_PORT'] ?? '3402', 10);
const FEE_BPS = 2; // 2 basis points = 0.02%
const TREASURY_WALLET = process.env['X402_TREASURY_WALLET'] ?? '';

function createLpcli(): LPCLI {
  return new LPCLI();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function parseQuery(url: string): Record<string, string> {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const params: Record<string, string> = {};
  for (const part of url.slice(idx + 1).split('&')) {
    const [k, v] = part.split('=');
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
  }
  return params;
}

function getPath(url: string): string {
  const idx = url.indexOf('?');
  return idx === -1 ? url : url.slice(0, idx);
}

/**
 * Calculate the x402 fee for a position open.
 * Fee = position_size_in_lamports * FEE_BPS / 10000
 */
function calculateFee(amountX: number, amountY: number): number {
  const totalLamports = (amountX || 0) + (amountY || 0);
  return Math.ceil(totalLamports * FEE_BPS / 10_000);
}

/**
 * Build a 402 Payment Required response per x402 protocol.
 *
 * The x402 spec returns:
 *   - x402-version: 1
 *   - x402-payment: JSON with { chain, currency, amount, recipient, description }
 *
 * The agent's OWS wallet reads this and auto-pays.
 */
function respond402(res: ServerResponse, feeLamports: number, description: string): void {
  const payment = {
    version: 1,
    chain: 'solana:mainnet',
    currency: 'SOL',
    amount: feeLamports,
    amount_human: `${(feeLamports / 1e9).toFixed(9)} SOL`,
    recipient: TREASURY_WALLET,
    description,
    fee_bps: FEE_BPS,
  };

  const paymentJson = JSON.stringify(payment);
  const paymentB64 = Buffer.from(paymentJson).toString('base64');

  res.writeHead(402, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'x-402-version': '1',
    'x-402-payment': paymentB64,
  });
  res.end(JSON.stringify({
    error: 'Payment Required',
    payment,
  }));
}

/**
 * Verify an x402 payment receipt.
 *
 * In production this would verify a Solana transaction signature:
 * - Confirm the tx is finalized
 * - Confirm the amount and recipient match
 * - Confirm it hasn't been used before (replay protection)
 *
 * For hackathon: we verify the receipt header exists and contains a tx signature.
 * TODO: Full on-chain verification post-hackathon.
 */
async function verifyPayment(
  req: IncomingMessage,
  expectedFee: number
): Promise<{ valid: boolean; tx?: string; error?: string }> {
  const receipt = req.headers['x-402-receipt'] as string | undefined;
  if (!receipt) {
    return { valid: false, error: 'Missing x-402-receipt header' };
  }

  try {
    const parsed = JSON.parse(receipt) as { tx: string; amount: number; chain: string };

    if (!parsed.tx || typeof parsed.tx !== 'string') {
      return { valid: false, error: 'Invalid receipt: missing tx signature' };
    }

    // TODO: On-chain verification
    // 1. Fetch tx from Solana RPC
    // 2. Confirm it transfers >= expectedFee lamports to TREASURY_WALLET
    // 3. Confirm tx is finalized
    // 4. Check against replay set
    void expectedFee;

    return { valid: true, tx: parsed.tx };
  } catch {
    return { valid: false, error: 'Invalid receipt format' };
  }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleDiscover(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const query = parseQuery(req.url ?? '');
  const token = query['token'];
  if (!token) {
    json(res, 400, { error: 'Missing ?token= parameter' });
    return;
  }

  const sortBy = (query['sort_by'] ?? 'score') as 'score' | 'fee_yield' | 'volume' | 'tvl';
  const limit = Math.min(parseInt(query['limit'] ?? '10', 10), 50);

  const lpcli = createLpcli();
  const pools = await lpcli.discoverPools(token, sortBy, limit);
  json(res, 200, { pools });
}

async function handlePool(path: string, res: ServerResponse): Promise<void> {
  const address = path.split('/')[2];
  if (!address) {
    json(res, 400, { error: 'Missing pool address: /pool/:address' });
    return;
  }

  const lpcli = createLpcli();
  const pool = await lpcli.getPoolInfo(address);
  json(res, 200, { pool });
}

async function handlePositions(path: string, res: ServerResponse): Promise<void> {
  const wallet = path.split('/')[2];
  if (!wallet) {
    json(res, 400, { error: 'Missing wallet: /positions/:wallet' });
    return;
  }

  const lpcli = createLpcli();
  await lpcli.getWallet();
  const positions = await lpcli.dlmm!.getPositions(wallet);
  json(res, 200, { positions });
}

async function handleOpen(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = JSON.parse(await readBody(req)) as {
    pool: string;
    amount_x?: number;
    amount_y?: number;
    strategy?: 'spot' | 'curve' | 'bidask';
    width_bins?: number;
  };

  if (!body.pool) {
    json(res, 400, { error: 'Missing pool address' });
    return;
  }

  // Calculate fee
  const feeLamports = calculateFee(body.amount_x ?? 0, body.amount_y ?? 0);

  // Check for payment
  const payment = await verifyPayment(req, feeLamports);
  if (!payment.valid) {
    // No valid payment — respond 402
    respond402(
      res,
      feeLamports,
      `Open position on ${body.pool} — 2 bps fee on ${((body.amount_x ?? 0) + (body.amount_y ?? 0)) / 1e9} SOL`
    );
    return;
  }

  // Payment verified — execute
  const lpcli = createLpcli();
  await lpcli.getWallet();

  const result = await lpcli.dlmm!.openPosition({
    pool: body.pool,
    amountX: body.amount_x,
    amountY: body.amount_y,
    strategy: body.strategy,
    widthBins: body.width_bins,
  });

  json(res, 200, {
    ...result,
    fee_paid: feeLamports,
    fee_tx: payment.tx,
  });
}

async function handleClose(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = JSON.parse(await readBody(req)) as { position: string };

  if (!body.position) {
    json(res, 400, { error: 'Missing position address' });
    return;
  }

  const lpcli = createLpcli();
  await lpcli.getWallet();
  const result = await lpcli.dlmm!.closePosition(body.position);
  json(res, 200, result);
}

async function handleClaim(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = JSON.parse(await readBody(req)) as { position: string };

  if (!body.position) {
    json(res, 400, { error: 'Missing position address' });
    return;
  }

  const lpcli = createLpcli();
  await lpcli.getWallet();
  const result = await lpcli.dlmm!.claimFees(body.position);
  json(res, 200, result);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const path = getPath(req.url ?? '/');

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-402-receipt',
    });
    res.end();
    return;
  }

  try {
    // Free endpoints
    if (method === 'GET' && path === '/discover') return await handleDiscover(req, res);
    if (method === 'GET' && path.startsWith('/pool/')) return await handlePool(path, res);
    if (method === 'GET' && path.startsWith('/positions/')) return await handlePositions(path, res);
    if (method === 'POST' && path === '/close') return await handleClose(req, res);
    if (method === 'POST' && path === '/claim') return await handleClaim(req, res);

    // Paid endpoint
    if (method === 'POST' && path === '/open') return await handleOpen(req, res);

    // Health
    if (method === 'GET' && path === '/health') {
      json(res, 200, { status: 'ok', version: '0.1.0' });
      return;
    }

    // Not found
    json(res, 404, { error: 'Not found' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    json(res, 500, { error: message });
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const httpServer = createServer((req, res) => {
  handleRequest(req, res).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    json(res, 500, { error: message });
  });
});

httpServer.listen(PORT, () => {
  console.log(`lpcli x402 server running on http://localhost:${PORT}`);
  console.log(`Treasury: ${TREASURY_WALLET || '(not set — set X402_TREASURY_WALLET)'}`);
  console.log(`Fee: ${FEE_BPS} bps on open_position`);
  console.log(`\nEndpoints:`);
  console.log(`  GET  /discover?token=SOL     (free)`);
  console.log(`  GET  /pool/:address          (free)`);
  console.log(`  GET  /positions/:wallet      (free)`);
  console.log(`  POST /open                   (x402 — ${FEE_BPS} bps)`);
  console.log(`  POST /close                  (free)`);
  console.log(`  POST /claim                  (free)`);
  console.log(`  GET  /health                 (free)`);
});
