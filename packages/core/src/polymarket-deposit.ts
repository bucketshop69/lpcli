import { LPCLIConfig } from './config.js';
import { WalletService } from './wallet.js';

export interface PolymarketDepositAddresses {
  svm: string;
  evm: string;
  btc: string;
  other?: Record<string, string>;
}

/**
 * Derives the deposit addresses for Polymarket Bridge.
 * SVM address allows funding Polymarket (Polygon) from a Solana wallet.
 */
export async function getDepositAddresses(
  config: LPCLIConfig,
  wallet: WalletService,
  polygonAddress: string
): Promise<PolymarketDepositAddresses> {
  const url = 'https://bridge.polymarket.com/deposit';
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ address: polygonAddress }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Polymarket deposit addresses: ${response.statusText}`);
  }

  const data = await response.json();
  
  return {
    svm: data.svm,
    evm: data.evm,
    btc: data.btc,
    other: data.other
  };
}
