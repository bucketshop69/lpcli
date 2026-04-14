import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EvmWalletService } from '../src/evm-wallet.js';

describe('EvmWalletService', () => {
  it('initialises from OWS wallet and returns EVM address', async () => {
    const svc = await EvmWalletService.init('lpcli');
    const address = svc.getAddress();

    console.log('EVM address:', address);
    assert.ok(address.startsWith('0x'), 'address should start with 0x');
    assert.equal(address.length, 42, 'address should be 42 chars');
  });

  it('signs a personal message', async () => {
    const svc = await EvmWalletService.init('lpcli');
    const result = await svc.signMessage('hello polymarket');

    console.log('Signature:', result.signature.slice(0, 20) + '...');
    assert.ok(result.signature.startsWith('0x'), 'signature should be 0x-prefixed');
    // EVM personal_sign produces 65 bytes = 130 hex chars + 0x prefix
    assert.ok(result.signature.length >= 130, `signature too short: ${result.signature.length}`);
  });

  it('signs EIP-712 typed data', async () => {
    // Minimal EIP-712 typed data structure
    const typedData = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'chainId', type: 'uint256' },
        ],
        Test: [
          { name: 'message', type: 'string' },
        ],
      },
      primaryType: 'Test',
      domain: {
        name: 'TestDomain',
        chainId: 137,
      },
      message: {
        message: 'hello from lpcli',
      },
    };

    const svc = await EvmWalletService.init('lpcli');
    const result = await svc.signTypedData(typedData);

    console.log('EIP-712 signature:', result.signature.slice(0, 20) + '...');
    assert.ok(result.signature.startsWith('0x'), 'signature should be 0x-prefixed');
    assert.ok(result.signature.length >= 130, `signature too short: ${result.signature.length}`);
  });

  it('throws for non-existent wallet', async () => {
    await assert.rejects(
      () => EvmWalletService.init('nonexistent-wallet-xyz'),
      /not found/i,
    );
  });
});
