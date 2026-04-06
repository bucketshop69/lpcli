/**
 * Pool Meta E2E — log raw getPoolMeta output.
 *
 * Run with: pnpm --filter @lpcli/core test:e2e:poolmeta
 */

import { test } from 'node:test';
import { LPCLI } from '../src/index.js';

const POOL = 'BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y';

test('getPoolMeta — log output', async () => {
  const lpcli = new LPCLI();
  await lpcli.getWallet();
  const dlmm = lpcli.dlmm!;

  console.log(`\n  Pool: ${POOL}`);
  const meta = await dlmm.getPoolMeta(POOL);
  console.log('\n  PoolMeta (our return):', JSON.stringify(meta, null, 2));

  // Also log the raw SDK instance to see everything available
  const raw = await dlmm.getRawInstance(POOL);
  const safe = (_k: string, v: unknown) => typeof v === 'bigint' ? v.toString() : v;
  console.log('\n  --- Raw SDK lbPair ---');
  console.log(JSON.stringify(raw.lbPair, safe, 2));
  console.log('\n  --- Raw SDK tokenX ---');
  console.log(JSON.stringify(raw.tokenX, safe, 2));
  console.log('\n  --- Raw SDK tokenY ---');
  console.log(JSON.stringify(raw.tokenY, safe, 2));
  console.log('\n  --- Raw SDK getActiveBin() ---');
  const activeBin = await raw.getActiveBin();
  console.log(JSON.stringify(activeBin, null, 2));
});
