/**
 * pacific Deposit/Withdraw/Balance E2E Tests
 *
 * Tests 1-3: Pure logic — no OWS/RPC needed.
 * Tests 4-6: Require OWS wallet + RPC.
 * Test 7: Live pacific API.
 *
 * Run with: pnpm --filter @lpcli/core test:e2e:deposit
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  createDepositInstruction,
  buildDepositTransaction,
  pacific_PROGRAM_ID,
  pacific_VAULT_PDA,
  pacific_VAULT_USDC_ATA,
  pacific_EVENT_AUTHORITY,
  pacific_USDC_MINT,
  pacificClient,
  pacificApiError,
  WalletService,
} from '../src/index.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { SystemProgram } from '@solana/web3.js';

const DUMMY_RPC = 'https://api.mainnet-beta.solana.com';

// A deterministic test wallet (not a real funded wallet)
const TEST_WALLET = new PublicKey('7iNJ7CLNT8UBPANxkkrsURjzaktbomCVa93N1sKcVo9C');

// ---------------------------------------------------------------------------
// Helper: try to init OWS wallet, return null if unavailable
// ---------------------------------------------------------------------------

async function tryInitWallet(): Promise<WalletService | null> {
  try {
    return await WalletService.init('lpcli', DUMMY_RPC);
  } catch {
    console.log('  Skipping: OWS wallet "lpcli" not available');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pure logic tests (no OWS / no RPC)
// ---------------------------------------------------------------------------

describe('createDepositInstruction', { concurrency: false }, () => {

  test('1: produces correct instruction data', () => {
    const ix = createDepositInstruction(TEST_WALLET, 100);

    // Discriminator check
    const discriminator = ix.data.subarray(0, 8).toString('hex');
    assert.strictEqual(discriminator, 'f223c68952e1f2b6', 'discriminator should match');

    // Amount check: 100 USDC = 100_000_000 raw
    const amount = ix.data.readBigUInt64LE(8);
    assert.strictEqual(amount, BigInt(100_000_000), 'amount should be 100 * 1e6');

    // 10 account keys
    assert.strictEqual(ix.keys.length, 10, 'should have 10 account keys');

    // Program ID
    assert.ok(ix.programId.equals(pacific_PROGRAM_ID), 'programId should be pacific');
  });

  test('2: account ordering matches on-chain format', () => {
    const ix = createDepositInstruction(TEST_WALLET, 1);
    const expectedUserAta = getAssociatedTokenAddressSync(pacific_USDC_MINT, TEST_WALLET);

    // accounts[0] = user wallet (signer, writable)
    assert.ok(ix.keys[0].pubkey.equals(TEST_WALLET), 'accounts[0] should be user wallet');
    assert.strictEqual(ix.keys[0].isSigner, true, 'accounts[0] should be signer');
    assert.strictEqual(ix.keys[0].isWritable, true, 'accounts[0] should be writable');

    // accounts[1] = user USDC ATA (writable)
    assert.ok(ix.keys[1].pubkey.equals(expectedUserAta), 'accounts[1] should be user USDC ATA');
    assert.strictEqual(ix.keys[1].isWritable, true, 'accounts[1] should be writable');

    // accounts[2] = vault PDA (writable)
    assert.ok(ix.keys[2].pubkey.equals(pacific_VAULT_PDA), 'accounts[2] should be vault PDA');
    assert.strictEqual(ix.keys[2].isWritable, true, 'accounts[2] should be writable');

    // accounts[3] = vault USDC ATA (writable)
    assert.ok(ix.keys[3].pubkey.equals(pacific_VAULT_USDC_ATA), 'accounts[3] should be vault USDC ATA');
    assert.strictEqual(ix.keys[3].isWritable, true, 'accounts[3] should be writable');

    // accounts[4] = Token Program
    assert.ok(ix.keys[4].pubkey.equals(TOKEN_PROGRAM_ID), 'accounts[4] should be Token Program');
    assert.strictEqual(ix.keys[4].isWritable, false);

    // accounts[5] = ATA Program
    assert.ok(ix.keys[5].pubkey.equals(ASSOCIATED_TOKEN_PROGRAM_ID), 'accounts[5] should be ATA Program');
    assert.strictEqual(ix.keys[5].isWritable, false);

    // accounts[6] = USDC Mint
    assert.ok(ix.keys[6].pubkey.equals(pacific_USDC_MINT), 'accounts[6] should be USDC Mint');
    assert.strictEqual(ix.keys[6].isWritable, false);

    // accounts[7] = System Program
    assert.ok(ix.keys[7].pubkey.equals(SystemProgram.programId), 'accounts[7] should be System Program');
    assert.strictEqual(ix.keys[7].isWritable, false);

    // accounts[8] = Config
    assert.ok(ix.keys[8].pubkey.equals(pacific_EVENT_AUTHORITY), 'accounts[8] should be Event Authority');
    assert.strictEqual(ix.keys[8].isWritable, false);

    // accounts[9] = pacific Program (self-ref)
    assert.ok(ix.keys[9].pubkey.equals(pacific_PROGRAM_ID), 'accounts[9] should be pacific Program');
    assert.strictEqual(ix.keys[9].isWritable, false);
  });

  test('3: handles decimal amounts correctly', () => {
    // 0.01 USDC → 10_000 raw
    const ix1 = createDepositInstruction(TEST_WALLET, 0.01);
    assert.strictEqual(ix1.data.readBigUInt64LE(8), BigInt(10_000));

    // 200.015160 USDC → 200_015_160 raw (matches the real tx)
    const ix2 = createDepositInstruction(TEST_WALLET, 200.015160);
    assert.strictEqual(ix2.data.readBigUInt64LE(8), BigInt(200_015_160));

    // 100_000 USDC → 100_000_000_000 raw
    const ix3 = createDepositInstruction(TEST_WALLET, 100_000);
    assert.strictEqual(ix3.data.readBigUInt64LE(8), BigInt(100_000_000_000));
  });

});

// ---------------------------------------------------------------------------
// OWS + RPC dependent tests
// ---------------------------------------------------------------------------

describe('buildDepositTransaction', { concurrency: false }, () => {

  test('4: produces a valid unsigned transaction', async () => {
    const wallet = await tryInitWallet();
    if (!wallet) return;

    const connection = wallet.getConnection();
    const pubkey = wallet.getPublicKey();
    const tx = await buildDepositTransaction(pubkey, 1, connection);

    // 1 instruction
    assert.strictEqual(tx.instructions.length, 1, 'should have 1 instruction');

    // Fee payer matches wallet
    assert.ok(tx.feePayer?.equals(pubkey), 'feePayer should match wallet pubkey');

    // Has a recent blockhash
    assert.ok(tx.recentBlockhash, 'should have recentBlockhash');
    assert.ok(tx.recentBlockhash.length > 30, 'blockhash should be a reasonable length');
  });

});

// ---------------------------------------------------------------------------
// Live pacific API tests (no auth required)
// ---------------------------------------------------------------------------

describe('pacificClient', { concurrency: false }, () => {

  test('5: getAccountInfo returns balance data or 404', async () => {
    const wallet = await tryInitWallet();
    if (!wallet) return;

    const client = new pacificClient();
    const address = wallet.getPublicKey().toBase58();

    try {
      const info = await client.getAccountInfo(address);
      // Account exists — verify fields
      assert.ok('balance' in info, 'should have balance');
      assert.ok('account_equity' in info, 'should have account_equity');
      assert.ok('available_to_spend' in info, 'should have available_to_spend');
    } catch (err) {
      // 404 is fine — account not registered on pacific
      assert.ok(err instanceof pacificApiError, 'should throw pacificApiError');
      assert.strictEqual((err as pacificApiError).status, 404, 'should be 404');
    }
  });

  test('6: getMarkets returns market list', async () => {
    const client = new pacificClient();
    const markets = await client.getMarkets();

    assert.ok(Array.isArray(markets), 'should return an array');
    assert.ok(markets.length >= 1, 'should have at least 1 market');

    const first = markets[0];
    assert.ok('symbol' in first, 'market should have symbol');
    assert.ok('max_leverage' in first, 'market should have max_leverage');
    assert.ok('lot_size' in first, 'market should have lot_size');
  });

  test('7: getPrices returns price data', async () => {
    const client = new pacificClient();
    const prices = await client.getPrices();

    assert.ok(Array.isArray(prices), 'should return an array');
    assert.ok(prices.length >= 1, 'should have at least 1 price entry');

    const first = prices[0];
    assert.ok('symbol' in first, 'price should have symbol');
    assert.ok('oracle' in first, 'price should have oracle');
    assert.ok('mark' in first, 'price should have mark');
  });

});

console.log(`
pacific Deposit/Withdraw/Balance E2E Tests
`);
