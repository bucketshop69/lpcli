/**
 * `lpcli eliza` — Start the conversational DeFi agent.
 *
 * Guided wizard:
 *   1. Ensure @nosana/cli installed (auto-install if missing)
 *   2. Ensure OWS wallet exists (run init if missing)
 *   3. Fetch GPU markets from Nosana API → user picks
 *   4. Calculate exact NOS cost → check balance → offer auto-swap SOL→NOS
 *   5. Confirm + launch Nosana job
 *   6. Wait for LLM → boot ElizaOS
 *
 * Usage:
 *   lpcli eliza                     Guided setup + start
 *   lpcli eliza --local             Use local Ollama (skip Nosana)
 */

import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

// ── Constants ────────────────────────────────────────────────────────────

const DEFAULT_MODEL = 'qwen3:8b';
const DEFAULT_TIMEOUT = 120; // minutes
const OLLAMA_PORT = 11434;
const ELIZAOS_PORT = 3000;
const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_ATTEMPTS = 60;
const WALLET_NAME = 'lpcli';

const NOS_MINT = 'nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const NOSANA_API = 'https://dashboard.k8s.prd.nos.ci/api';
const NOS_DECIMALS = 6;
const LAMPORTS_PER_SOL = 1_000_000_000;

// ── Types ────────────────────────────────────────────────────────────────

interface NosanaMarket {
  name: string;
  slug: string;
  address: string;
  nos_job_price_per_second: number;
  gpu_types: string[];
  lowest_vram: number;
  type: string;
}

// ── Readline ─────────────────────────────────────────────────────────────

function createRL() {
  return createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl: ReturnType<typeof createRL>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

// ── Step 1: Ensure Nosana CLI ────────────────────────────────────────────

function ensureNosanaCLI(): void {
  try {
    execSync('nosana --version', { stdio: 'ignore', timeout: 10_000 });
    console.log('  [ok] Nosana CLI installed');
  } catch {
    console.log('  Installing Nosana CLI...');
    try {
      execSync('npm install -g @nosana/cli', { stdio: 'inherit', timeout: 120_000 });
      console.log('  [ok] Nosana CLI installed');
    } catch {
      console.error('\n  Failed to install @nosana/cli.');
      console.error('  Try manually: npm install -g @nosana/cli');
      process.exit(1);
    }
  }
}

// ── Step 2: Ensure OWS wallet ────────────────────────────────────────────

function ensureWallet(): { name: string; address: string } {
  const walletName = process.env.OWS_WALLET || WALLET_NAME;

  try {
    execSync('ows --version', { stdio: 'ignore' });
  } catch {
    console.log('  OWS not found. Installing...');
    execSync('npm install -g @open-wallet-standard/core', { stdio: 'inherit' });
  }

  let output: string;
  try {
    output = execSync('ows wallet list', { encoding: 'utf-8' });
  } catch {
    output = '';
  }

  const walletExists = output.includes(`Name:    ${walletName}`) || output.includes(`Name: ${walletName}`);

  if (!walletExists) {
    console.log(`  No wallet found. Creating "${walletName}"...`);
    execSync(`ows wallet create --name "${walletName}"`, { stdio: 'inherit' });
    output = execSync('ows wallet list', { encoding: 'utf-8' });
  }

  const blocks = output.split(/\n(?=ID:)/);
  for (const block of blocks) {
    const nameMatch = block.match(/Name:\s+(\S+)/);
    if (!nameMatch || nameMatch[1] !== walletName) continue;
    const addrMatch = block.match(/solana:[^\s]+\s+\(solana\)\s+→\s+([1-9A-HJ-NP-Za-km-z]{32,44})/);
    if (addrMatch) {
      console.log(`  [ok] Wallet: ${walletName} (${addrMatch[1]})`);
      return { name: walletName, address: addrMatch[1] };
    }
  }

  console.error('  Could not find Solana address in OWS wallet.');
  process.exit(1);
}

// ── Step 3: Fetch GPU markets from Nosana API ────────────────────────────

async function fetchMarkets(): Promise<NosanaMarket[]> {
  console.log('  Fetching GPU markets from Nosana...\n');

  const resp = await fetch(`${NOSANA_API}/markets`);
  if (!resp.ok) throw new Error(`Nosana API returned ${resp.status}`);

  const markets = await resp.json() as NosanaMarket[];

  // Filter to usable markets with pricing and nodes
  return markets.filter(m =>
    m.nos_job_price_per_second > 0 &&
    m.gpu_types.length > 0 &&
    !m.slug.includes('tee') &&           // skip TEE markets
    !m.slug.includes('zephyr') &&         // skip private markets
    !m.slug.includes('ember') &&
    !m.slug.includes('silent') &&
    !m.slug.includes('frost')
  );
}

function formatNosPerHour(nosPerSec: number): string {
  return (nosPerSec * 3600).toFixed(2);
}

function calculateCost(nosPerSec: number, timeoutMinutes: number): number {
  return nosPerSec * timeoutMinutes * 60;
}

async function selectMarket(rl: ReturnType<typeof createRL>, markets: NosanaMarket[]): Promise<{ market: NosanaMarket; timeout: number }> {
  // Group into tiers: budget, mid, pro
  const budget = markets.filter(m => /3060|3070|3080|4060/i.test(m.slug));
  const mid = markets.filter(m => /4070$|4080$|4090$|5070$|5080$/i.test(m.slug));
  const pro = markets.filter(m => /a100|a40$|a5000$|a6000$|h100$|6000-ada$|8x/i.test(m.slug));

  // Pick one representative from each tier (non-community first)
  const pickBest = (group: NosanaMarket[]): NosanaMarket[] => {
    const premium = group.filter(m => !m.slug.includes('community'));
    const community = group.filter(m => m.slug.includes('community'));
    // Show premium first, then community alternatives
    const seen = new Set<string>();
    const result: NosanaMarket[] = [];
    for (const m of [...premium, ...community]) {
      // Deduplicate by base GPU name
      const base = m.slug.replace('-community', '');
      if (!seen.has(base) || m.slug.includes('community')) {
        seen.add(m.slug);
        result.push(m);
      }
    }
    return result;
  };

  const curated = [...pickBest(budget).slice(0, 2), ...pickBest(mid).slice(0, 3), ...pickBest(pro).slice(0, 2)];

  // Deduplicate
  const seen = new Set<string>();
  const display: NosanaMarket[] = [];
  for (const m of curated) {
    if (!seen.has(m.slug)) {
      seen.add(m.slug);
      display.push(m);
    }
  }

  // If curation gave nothing, take first 7
  if (display.length === 0) {
    for (const m of markets.slice(0, 7)) {
      if (!seen.has(m.slug)) { seen.add(m.slug); display.push(m); }
    }
  }

  console.log('  Available GPU tiers:\n');
  console.log('    #  GPU                            VRAM     NOS/hr   ~$/hr');
  console.log('    ─  ───                            ────     ──────   ─────');
  display.forEach((m, i) => {
    const num = String(i + 1).padEnd(2);
    const name = m.name.padEnd(30);
    const vram = m.lowest_vram ? `${m.lowest_vram}GB`.padEnd(8) : '?'.padEnd(8);
    const nosHr = formatNosPerHour(m.nos_job_price_per_second).padStart(6);
    const usdHr = (m.nos_job_price_per_second * 3600 * 0.10).toFixed(2).padStart(5); // ~$0.10/NOS estimate
    console.log(`    ${num} ${name} ${vram} ${nosHr}   $${usdHr}`);
  });
  console.log(`    ${display.length + 1}  Show all ${markets.length} markets`);

  const choice = await ask(rl, `\n  Select GPU [1-${display.length + 1}]: `);
  let selected: NosanaMarket;
  const idx = parseInt(choice, 10) - 1;

  if (idx === display.length) {
    // Show all
    console.log('\n  All markets:\n');
    console.log('    #   GPU                            VRAM     NOS/hr   ~$/hr');
    console.log('    ──  ───                            ────     ──────   ─────');
    markets.forEach((m, i) => {
      const num = String(i + 1).padEnd(3);
      const name = m.name.padEnd(30);
      const vram = m.lowest_vram ? `${m.lowest_vram}GB`.padEnd(8) : '?'.padEnd(8);
      const nosHr = formatNosPerHour(m.nos_job_price_per_second).padStart(6);
      const usdHr = (m.nos_job_price_per_second * 3600 * 0.10).toFixed(2).padStart(5);
      console.log(`    ${num} ${name} ${vram} ${nosHr}   $${usdHr}`);
    });
    const allChoice = await ask(rl, `\n  Select GPU [1-${markets.length}]: `);
    const allIdx = parseInt(allChoice, 10) - 1;
    selected = (allIdx >= 0 && allIdx < markets.length) ? markets[allIdx] : (markets.find(m => m.slug === 'nvidia-4090') ?? markets[0]);
  } else if (idx >= 0 && idx < display.length) {
    selected = display[idx];
  } else {
    selected = markets.find(m => m.slug === 'nvidia-4090') ?? markets[0];
  }

  // Ask duration
  const timeoutInput = await ask(rl, `\n  Session duration in minutes [${DEFAULT_TIMEOUT}]: `);
  const timeout = timeoutInput ? parseInt(timeoutInput, 10) : DEFAULT_TIMEOUT;

  return { market: selected, timeout };
}

// ── Step 4: Balance check + auto-swap ────────────────────────────────────

interface Balances {
  sol: number;
  solLamports: number;
  nos: number;
  nosRaw: number;
}

async function checkBalances(address: string): Promise<Balances> {
  const rpcUrl = process.env.HELIUS_RPC_URL || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

  // SOL
  let solLamports = 0;
  try {
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] }),
    });
    const data = await resp.json() as { result?: { value: number } };
    solLamports = data.result?.value ?? 0;
  } catch { /* leave as 0 */ }

  // NOS
  let nosRaw = 0;
  try {
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getTokenAccountsByOwner',
        params: [address, { mint: NOS_MINT }, { encoding: 'jsonParsed' }],
      }),
    });
    const data = await resp.json() as {
      result?: { value: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number; amount: string } } } } } }[] }
    };
    const accounts = data.result?.value ?? [];
    if (accounts.length > 0) {
      const info = accounts[0].account.data.parsed.info.tokenAmount;
      nosRaw = parseInt(info.amount);
    }
  } catch { /* leave as 0 */ }

  return {
    sol: solLamports / LAMPORTS_PER_SOL,
    solLamports,
    nos: nosRaw / (10 ** NOS_DECIMALS),
    nosRaw,
  };
}

async function showBalances(
  balances: Balances,
  nosNeeded: number,
  address: string,
): Promise<boolean> {
  console.log(`\n  Balance check:`);
  console.log(`    SOL: ${balances.sol.toFixed(4)}`);
  console.log(`    NOS: ${balances.nos.toFixed(4)} (need ${nosNeeded.toFixed(4)})`);

  if (balances.sol < 0.01) {
    console.log(`\n  [!] Not enough SOL for transaction fees.`);
    console.log(`      Send SOL to: ${address}\n`);
    return false;
  }

  if (balances.nos >= nosNeeded) {
    console.log(`    [ok] Sufficient NOS balance`);
  } else {
    console.log(`    [!] Short ${(nosNeeded - balances.nos).toFixed(4)} NOS — will auto-acquire before launch`);
  }

  return true;
}

// ── Step 5: Confirm ──────────────────────────────────────────────────────

async function confirmLaunch(
  rl: ReturnType<typeof createRL>,
  market: NosanaMarket,
  model: string,
  timeout: number,
  totalNos: number,
): Promise<boolean> {
  console.log(`
  ┌────────────────────────────────────────────────────────────┐
  │  Ready to launch                                          │
  ├────────────────────────────────────────────────────────────┤
  │  GPU:       ${market.name.padEnd(46)}│
  │  VRAM:      ${(market.lowest_vram ? market.lowest_vram + 'GB' : 'N/A').padEnd(46)}│
  │  Model:     ${model.padEnd(46)}│
  │  Duration:  ${(timeout + ' minutes').padEnd(46)}│
  │  Est. cost: ${(totalNos.toFixed(4) + ' NOS').padEnd(46)}│
  │  Rate:      ${(formatNosPerHour(market.nos_job_price_per_second) + ' NOS/hr').padEnd(46)}│
  └────────────────────────────────────────────────────────────┘
`);

  const answer = await ask(rl, '  Proceed? [Y/n]: ');
  return answer === '' || answer.toLowerCase() === 'y';
}

// ── Step 6: Fund Nosana wallet + post job ─────────────────────────────────

/**
 * Get the Nosana CLI wallet address by reading the keypair file directly.
 * Nosana auto-creates ~/.nosana/nosana_key.json on first run.
 */
function getNosanaWalletAddress(): string {
  const keyPath = join(process.env.HOME || '/root', '.nosana', 'nosana_key.json');

  // Trigger wallet creation if the file doesn't exist
  if (!existsSync(keyPath)) {
    execSync('nosana address 2>&1', { encoding: 'utf-8', timeout: 15_000 });
  }

  if (!existsSync(keyPath)) {
    throw new Error(`Nosana keypair not found at ${keyPath}. Run: nosana address`);
  }

  // Read the address from `nosana address`, stripping ANSI escape codes
  const raw = execSync('nosana address 2>&1', { encoding: 'utf-8', timeout: 15_000 });
  // Strip all ANSI escape sequences
  const clean = raw.replace(/\x1b\[[0-9;]*m/g, '');
  // Find Solana address (base58, 32-44 chars, starts with valid base58 char)
  const lines = clean.split('\n');
  for (const line of lines) {
    const match = line.match(/\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/);
    if (match) return match[1];
  }

  throw new Error('Could not determine Nosana wallet address from `nosana address`.');
}

/**
 * Transfer NOS + SOL from OWS wallet to Nosana CLI wallet using @lpcli/core.
 * This way the Nosana CLI can sign its own transactions — no key export needed.
 */
async function fundNosanaWallet(
  owsWalletName: string,
  nosanaAddress: string,
  nosAmount: number,
  solAmount: number,
): Promise<void> {
  const { WalletService } = await import('@lpcli/core');
  const rpcUrl = process.env.HELIUS_RPC_URL || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
  const wallet = await WalletService.init(owsWalletName, rpcUrl);

  // Transfer SOL for tx fees (if needed)
  if (solAmount > 0) {
    console.log(`  Transferring ${solAmount.toFixed(4)} SOL to Nosana wallet...`);
    await wallet.transferSOL(nosanaAddress, solAmount);
  }

  // Transfer NOS tokens
  if (nosAmount > 0) {
    const rawAmount = Math.ceil(nosAmount * (10 ** NOS_DECIMALS));
    console.log(`  Transferring ${nosAmount.toFixed(4)} NOS to Nosana wallet...`);
    await wallet.transferToken({ to: nosanaAddress, mint: NOS_MINT, amount: rawAmount });
  }
}

function buildJobDefinition(model: string): string {
  const jobDef = {
    version: '0.1',
    type: 'container',
    meta: { trigger: 'cli' },
    ops: [{
      type: 'container/run',
      id: 'lpcli-llm',
      args: {
        image: 'docker.io/ollama/ollama:0.6.6',
        entrypoint: ['/bin/sh'],
        cmd: ['-c', `ollama serve & sleep 5 && ollama pull ${model} && echo "Model ready" && tail -f /dev/null`],
        gpu: true,
        expose: OLLAMA_PORT,
      },
    }],
  };

  const tempPath = join(tmpdir(), `lpcli-job-${randomBytes(4).toString('hex')}.json`);
  writeFileSync(tempPath, JSON.stringify(jobDef, null, 2));
  return tempPath;
}

function postNosanaJob(
  jobDefPath: string,
  market: string,
  timeout: number,
): { serviceUrl: string; jobId: string } {
  // Uses Nosana CLI's own wallet (~/.nosana/nosana_key.json) — no --wallet flag needed
  // Nosana CLI may crash with moveCursor error after posting (non-TTY bug) but the job still succeeds.
  // Capture output regardless of exit code.
  let output: string;
  try {
    output = execSync(
      `nosana job post --file ${jobDefPath} --market ${market} --timeout ${timeout} --format text 2>&1`,
      { encoding: 'utf-8', timeout: 120_000 },
    );
  } catch (err: unknown) {
    // execSync throws on non-zero exit — extract stdout from the error
    const execErr = err as { stdout?: string; stderr?: string; output?: (string | null)[] };
    output = execErr.stdout || execErr.output?.filter(Boolean).join('\n') || '';
    if (!output) throw err;
  }

  // Nosana CLI outputs URL in various formats:
  //   Service URL:  ['https://xxx.node.k8s.prd.nos.ci']
  //   Service will be exposed at https://xxx.node.k8s.prd.nos.ci
  const urlMatch = output.match(/(https:\/\/[A-Za-z0-9]+\.node\.k8s\.prd\.nos\.ci)/);
  if (!urlMatch) {
    throw new Error('Could not find service URL in Nosana output.\n\n' + output);
  }

  // Job ID is the subdomain (Solana pubkey of the job account)
  const subdomainMatch = urlMatch[1].match(/https:\/\/([A-Za-z0-9]+)\.node/);
  const jobId = subdomainMatch ? subdomainMatch[1] : 'unknown';

  return { serviceUrl: urlMatch[1], jobId };
}

// ── Step 7: Wait for endpoint + start ElizaOS ────────────────────────────

async function waitForEndpoint(baseUrl: string, model: string): Promise<void> {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(`${baseUrl}/api/tags`);
      if (resp.ok) {
        const data = await resp.json() as { models?: { name: string }[] };
        const models = data.models ?? [];
        if (models.some(m => m.name.includes(model.split(':')[0]))) {
          console.log(`  [ok] LLM ready (${models.length} model(s) loaded)\n`);
          return;
        }
        process.stdout.write(`\r  Downloading model... (${attempt}/${MAX_POLL_ATTEMPTS})   `);
      }
    } catch {
      process.stdout.write(`\r  Waiting for GPU node... (${attempt}/${MAX_POLL_ATTEMPTS})   `);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`LLM endpoint not ready after ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 60_000} min.`);
}

function startElizaOS(ollamaUrl: string, model: string): ChildProcess {
  let root = process.cwd();
  while (!existsSync(join(root, 'pnpm-workspace.yaml')) && root !== '/') {
    root = join(root, '..');
  }

  const child = spawn('pnpm', ['--filter', '@lpcli/eliza', 'start'], {
    cwd: root,
    env: {
      ...process.env,
      OPENAI_API_KEY: 'nosana',
      OPENAI_API_URL: `${ollamaUrl}/v1`,
      SMALL_MODEL: model,
      LARGE_MODEL: model,
      SERVER_PORT: String(ELIZAOS_PORT),
    },
    stdio: 'inherit',
  });

  return child;
}

// ── Main ─────────────────────────────────────────────────────────────────

export async function runEliza(args: string[]): Promise<void> {
  const isLocal = args.includes('--local');
  const modelIdx = args.indexOf('--model');
  const model = modelIdx !== -1 && args[modelIdx + 1] ? args[modelIdx + 1] : DEFAULT_MODEL;

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
lpcli eliza — Conversational DeFi agent

  Wallet is local (OWS). Compute is decentralized (Nosana). Trading is on-chain (Solana).

Usage:
  lpcli eliza                  Guided setup + start (Nosana GPU)
  lpcli eliza --local          Use local Ollama instead
  lpcli eliza --model <name>   LLM model (default: ${DEFAULT_MODEL})
`);
    return;
  }

  console.log(`
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   lpcli eliza — conversational DeFi agent                   │
│                                                             │
│   Wallet is local (OWS).                                    │
│   Compute is decentralized (Nosana).                        │
│   Trading is on-chain (Solana).                             │
│   No centralized dependency anywhere.                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
`);

  // ── Local mode ───────────────────────────────────────────────────
  if (isLocal) {
    const localUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
    console.log(`  Mode: local Ollama (${localUrl})\n`);

    try {
      const resp = await fetch(`${localUrl}/api/tags`);
      if (!resp.ok) throw new Error(`${resp.status}`);
    } catch {
      console.error(`  Ollama not running at ${localUrl}`);
      console.error('  Install: https://ollama.com\n');
      process.exit(1);
    }

    console.log(`  Starting ElizaOS at http://localhost:${ELIZAOS_PORT}\n`);
    const child = startElizaOS(localUrl, model);
    process.on('SIGINT', () => { child.kill('SIGINT'); process.exit(0); });
    process.on('SIGTERM', () => { child.kill('SIGTERM'); process.exit(0); });
    return;
  }

  // ── Nosana mode (guided wizard) ──────────────────────────────────

  const rl = createRL();

  try {
    // Step 1: Nosana CLI
    console.log('  Step 1/6 — Checking Nosana CLI...');
    ensureNosanaCLI();

    // Step 2: Wallet
    console.log('\n  Step 2/6 — Checking wallet...');
    const wallet = ensureWallet();

    // Step 3: GPU selection (BEFORE balance check — need price to calculate cost)
    console.log('\n  Step 3/6 — Select GPU...');
    const markets = await fetchMarkets();
    if (markets.length === 0) {
      console.error('  Could not fetch GPU markets from Nosana.');
      process.exit(1);
    }
    const { market, timeout } = await selectMarket(rl, markets);
    const totalNos = calculateCost(market.nos_job_price_per_second, timeout);

    console.log(`\n  Selected: ${market.name} (${market.slug})`);
    console.log(`  Duration: ${timeout} min → estimated cost: ${totalNos.toFixed(4)} NOS`);

    // Step 4: Balance check
    console.log('\n  Step 4/6 — Checking balances...');
    const balances = await checkBalances(wallet.address);
    const balanceOk = await showBalances(balances, totalNos, wallet.address);

    if (!balanceOk) {
      rl.close();
      return;
    }

    // Step 5: Confirm
    console.log('\n  Step 5/6 — Confirm...');
    const confirmed = await confirmLaunch(rl, market, model, timeout, totalNos);
    if (!confirmed) {
      console.log('  Cancelled.\n');
      rl.close();
      return;
    }

    rl.close();

    // Step 6: Launch
    console.log('  Step 6/6 — Launching...\n');

    // Get Nosana CLI wallet address (auto-creates if needed)
    console.log('  Setting up Nosana wallet...');
    const nosanaAddress = getNosanaWalletAddress();
    console.log(`  Nosana wallet: ${nosanaAddress}`);

    // Re-check OWS balance (may have changed since step 4)
    const currentBalances = await checkBalances(wallet.address);

    // If OWS doesn't have enough NOS, swap SOL→NOS first
    // Amount is in SOL lamports (input token). Estimate: 0.005 SOL ≈ plenty for any GPU session
    if (currentBalances.nos < totalNos) {
      const nosShortfall = totalNos - currentBalances.nos;
      // Swap 0.01 SOL → NOS (should yield plenty; SOL ~$130, NOS ~$0.10)
      // Use a generous SOL amount to cover the NOS shortfall + buffer
      const solToSwap = Math.max(0.005, nosShortfall * 0.001) ; // rough estimate, generous
      const solLamports = Math.ceil(solToSwap * LAMPORTS_PER_SOL);

      console.log(`  Swapping ${solToSwap.toFixed(4)} SOL → NOS via Jupiter...`);
      try {
        const { jupiterSwap, WalletService } = await import('@lpcli/core');
        const rpcUrl = process.env.HELIUS_RPC_URL || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
        const owsWallet = await WalletService.init(wallet.name, rpcUrl);

        const swapResult = await jupiterSwap({
          inputMint: SOL_MINT,
          outputMint: NOS_MINT,
          amount: solLamports,
        }, owsWallet);

        const nosReceived = parseInt(swapResult.outAmount) / (10 ** NOS_DECIMALS);
        console.log(`  [ok] Received ${nosReceived.toFixed(4)} NOS`);
      } catch (err) {
        console.error(`  Swap failed: ${err instanceof Error ? err.message : String(err)}`);
        console.error(`  Send NOS manually to: ${wallet.address}`);
        console.error(`  NOS token mint: ${NOS_MINT}\n`);
        return;
      }
    }

    // Now transfer NOS + SOL to Nosana wallet
    const nosanaBalances = await checkBalances(nosanaAddress);
    const nosToTransfer = totalNos * 2.0 - nosanaBalances.nos; // 2x buffer — on-chain cost exceeds API estimate
    const solNeeded = nosanaBalances.sol < 0.005 ? 0.01 : 0;

    if (nosToTransfer > 0 || solNeeded > 0) {
      console.log('  Funding Nosana wallet...');
      await fundNosanaWallet(wallet.name, nosanaAddress, Math.max(nosToTransfer, 0), solNeeded);
      console.log('  [ok] Nosana wallet funded');
    }

    let jobDefPath: string | undefined;
    let serviceUrl: string;
    let jobId: string;

    try {
      jobDefPath = buildJobDefinition(model);
      console.log('  Posting job to Nosana network...');
      const result = postNosanaJob(jobDefPath, market.slug, timeout);
      serviceUrl = result.serviceUrl;
      jobId = result.jobId;
    } finally {
      if (jobDefPath) try { unlinkSync(jobDefPath); } catch { /* */ }
    }

    console.log(`\n  Job ID:    ${jobId}`);
    console.log(`  Endpoint:  ${serviceUrl}`);
    console.log(`  Dashboard: https://dashboard.nosana.com/jobs/${jobId}\n`);

    // Wait for LLM
    await waitForEndpoint(serviceUrl, model);

    // Start ElizaOS
    console.log(`  Starting ElizaOS at http://localhost:${ELIZAOS_PORT}`);
    console.log(`  LLM: ${model} via Nosana (${market.name})`);
    console.log('  Press Ctrl+C to stop.\n');

    const child = startElizaOS(serviceUrl, model);

    const cleanup = () => {
      child.kill('SIGINT');
      console.log(`\n  ElizaOS stopped.`);
      console.log(`  Nosana job ${jobId} is still running (billed until timeout).`);
      console.log(`  Stop it early: nosana job stop ${jobId}\n`);
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

  } catch (err) {
    rl.close();
    throw err;
  }
}
