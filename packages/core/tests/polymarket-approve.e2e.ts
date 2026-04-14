import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkAllowances, POLYMARKET_SPENDERS } from '../src/polymarket-approve.js';

describe('Polymarket Allowance Check', () => {
  // Use the POC wallet (known to have approvals set)
  const KNOWN_APPROVED_WALLET = '0xFf24B17B582d3261c816D2d97Db5F633E12e9F03';

  it('reads USDC.e balance and POL balance from Polygon', async () => {
    const result = await checkAllowances(KNOWN_APPROVED_WALLET);

    console.log('Address:', result.polygonAddress);
    console.log('USDC.e:', result.usdceBalance.toFixed(6));
    console.log('POL:', result.polBalance.toFixed(6));

    assert.equal(result.polygonAddress, KNOWN_APPROVED_WALLET);
    assert.ok(typeof result.usdceBalance === 'number');
    assert.ok(typeof result.polBalance === 'number');
  });

  it('checks allowances for all three exchange contracts', async () => {
    const result = await checkAllowances(KNOWN_APPROVED_WALLET);

    console.log('\nAllowances:');
    for (const a of result.allowances) {
      console.log(`  ${a.name}: ${a.unlimited ? 'unlimited' : a.allowance.toFixed(2) + ' USDC.e'}`);
    }

    assert.equal(result.allowances.length, POLYMARKET_SPENDERS.length);
    for (const a of result.allowances) {
      assert.ok(a.name, 'allowance should have a name');
      assert.ok(a.spender.startsWith('0x'), 'spender should be an address');
    }
  });

  it('POC wallet has unlimited approvals (known state)', async () => {
    const result = await checkAllowances(KNOWN_APPROVED_WALLET);

    console.log('All approved:', result.allApproved);

    // The POC wallet was approved in earlier testing
    assert.ok(result.allApproved, 'POC wallet should have all approvals set');
    for (const a of result.allowances) {
      assert.ok(a.unlimited, `${a.name} should be unlimited`);
    }
  });

  it('fresh wallet has zero allowances', async () => {
    // Random address that has never interacted with Polymarket
    const freshAddress = '0x0000000000000000000000000000000000000001';
    const result = await checkAllowances(freshAddress);

    console.log('Fresh wallet all approved:', result.allApproved);

    assert.ok(!result.allApproved, 'fresh wallet should not be approved');
    for (const a of result.allowances) {
      assert.ok(!a.unlimited, `${a.name} should not be unlimited for fresh wallet`);
      assert.equal(a.allowance, 0, `${a.name} allowance should be 0`);
    }
  });
});
