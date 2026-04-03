/**
 * @lpcli/mcp E2E Tests
 *
 * Tests the MCP server via JSON-RPC over stdio.
 * Run with: pnpm --filter @lpcli/mcp test:e2e
 *
 * No wallet needed — tests only cover read-only tools (discover, pool info).
 * Position operations (open/close/claim) require a funded wallet and are tested manually.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, '../dist/index.js');

// ---------------------------------------------------------------------------
// Helper: send JSON-RPC messages to MCP server via stdio
// ---------------------------------------------------------------------------

interface JsonRpcResponse {
  jsonrpc: string;
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

function startServer(): ChildProcess {
  return spawn('node', [SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

async function sendMessages(
  messages: string[],
  timeoutMs = 15_000
): Promise<JsonRpcResponse[]> {
  const proc = startServer();
  const responses: JsonRpcResponse[] = [];
  let buffer = '';

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill();
      resolve(responses);
    }, timeoutMs);

    proc.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      // MCP uses newline-delimited JSON
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          try {
            responses.push(JSON.parse(line));
          } catch {
            // skip non-JSON lines
          }
        }
      }
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      const msg = chunk.toString();
      if (msg.includes('error') || msg.includes('Error')) {
        console.error('  stderr:', msg.trim());
      }
    });

    proc.on('close', () => {
      clearTimeout(timer);
      // Parse any remaining buffer
      if (buffer.trim()) {
        try {
          responses.push(JSON.parse(buffer));
        } catch {
          // ignore
        }
      }
      resolve(responses);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    // Send all messages
    for (const msg of messages) {
      proc.stdin!.write(msg + '\n');
    }
    proc.stdin!.end();
  });
}

function initMessage(): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'lpcli-test', version: '1.0' },
    },
  });
}

function notifyInitialized(): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });
}

function toolsListMessage(id: number): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/list',
    params: {},
  });
}

function toolCallMessage(id: number, name: string, args: Record<string, unknown>): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP Server', { concurrency: false }, () => {

  test('should respond to initialize handshake', async () => {
    const responses = await sendMessages([initMessage()], 5_000);

    assert.ok(responses.length >= 1, 'should get at least 1 response');

    const initResp = responses.find((r) => r.id === 1);
    assert.ok(initResp, 'should get response with id=1');
    assert.ok(initResp.result, 'should have result');

    const result = initResp.result as {
      serverInfo: { name: string; version: string };
      capabilities: { tools?: unknown };
    };
    assert.strictEqual(result.serverInfo.name, 'lpcli');
    assert.strictEqual(result.serverInfo.version, '0.1.0');
    assert.ok(result.capabilities.tools, 'should advertise tools capability');

    console.log('  ✓ Server: lpcli v0.1.0, tools capability advertised');
  });

  test('should list all 6 tools', async () => {
    const responses = await sendMessages([
      initMessage(),
      notifyInitialized(),
      toolsListMessage(2),
    ], 5_000);

    const toolsResp = responses.find((r) => r.id === 2);
    assert.ok(toolsResp, 'should get tools/list response');
    assert.ok(toolsResp.result, 'should have result');

    const result = toolsResp.result as { tools: Array<{ name: string; description: string }> };
    const toolNames = result.tools.map((t) => t.name).sort();

    const expected = [
      'claim_fees',
      'close_position',
      'discover_pools',
      'get_pool_info',
      'get_positions',
      'open_position',
    ];

    assert.deepStrictEqual(toolNames, expected, 'should have exactly 6 tools');

    console.log('  ✓ Tools registered:', toolNames.join(', '));

    // Verify each tool has required fields
    for (const tool of result.tools) {
      assert.ok(tool.name, 'tool must have name');
      assert.ok(tool.description, 'tool must have description');
    }
  });

  test('should discover SOL pools (live Meteora API)', async () => {
    const responses = await sendMessages([
      initMessage(),
      notifyInitialized(),
      toolCallMessage(2, 'discover_pools', { token: 'SOL', limit: 3 }),
    ], 15_000);

    const callResp = responses.find((r) => r.id === 2);
    assert.ok(callResp, 'should get tool call response');
    assert.ok(callResp.result, 'should have result');

    const result = callResp.result as {
      content: Array<{ type: string; text: string }>;
    };
    assert.ok(result.content.length > 0, 'should return content');
    assert.strictEqual(result.content[0].type, 'text');

    const text = result.content[0].text;
    assert.ok(text.includes('SOL'), 'response should mention SOL');
    assert.ok(text.includes('Address:'), 'response should contain pool addresses');
    assert.ok(text.includes('TVL:'), 'response should contain TVL');
    assert.ok(text.includes('Score:'), 'response should contain scores');

    // Count pools returned
    const poolCount = (text.match(/^\d+\./gm) ?? []).length;
    assert.ok(poolCount >= 1 && poolCount <= 3, `should return 1-3 pools, got ${poolCount}`);

    console.log(`  ✓ Discovered ${poolCount} SOL pools from live Meteora API`);
  });

  test('should get pool info by address (live Meteora API)', async () => {
    // First discover to get a real pool address
    const discoverResp = await sendMessages([
      initMessage(),
      notifyInitialized(),
      toolCallMessage(2, 'discover_pools', { token: 'SOL', limit: 1 }),
    ], 15_000);

    const discoverResult = discoverResp.find((r) => r.id === 2);
    assert.ok(discoverResult?.result, 'discover should return result');

    const discoverText = (
      (discoverResult.result as { content: Array<{ text: string }> }).content[0].text
    );
    const addressMatch = discoverText.match(/Address: ([A-Za-z0-9]+)/);
    assert.ok(addressMatch, 'should find pool address in discover output');
    const poolAddress = addressMatch[1];

    // Now get pool info
    const infoResp = await sendMessages([
      initMessage(),
      notifyInitialized(),
      toolCallMessage(2, 'get_pool_info', { address: poolAddress }),
    ], 15_000);

    const infoResult = infoResp.find((r) => r.id === 2);
    assert.ok(infoResult?.result, 'pool info should return result');

    const infoText = (
      (infoResult.result as { content: Array<{ text: string }> }).content[0].text
    );
    assert.ok(infoText.includes('Pool:'), 'should have Pool name');
    assert.ok(infoText.includes('TVL:'), 'should have TVL');
    assert.ok(infoText.includes('Bin step:'), 'should have bin step');
    assert.ok(infoText.includes(poolAddress), 'should include the requested address');

    console.log(`  ✓ Got pool info for ${poolAddress}`);
  });

  test('should return "no pools" for nonsense token', async () => {
    const responses = await sendMessages([
      initMessage(),
      notifyInitialized(),
      toolCallMessage(2, 'discover_pools', { token: 'ZZZZNOTAREAL_TOKEN_999', limit: 1 }),
    ], 15_000);

    const callResp = responses.find((r) => r.id === 2);
    assert.ok(callResp?.result, 'should get result');

    const text = (
      (callResp.result as { content: Array<{ text: string }> }).content[0].text
    );
    assert.ok(
      text.toLowerCase().includes('no pools'),
      'should indicate no pools found'
    );

    console.log('  ✓ Returns "no pools" for nonexistent token');
  });
});
