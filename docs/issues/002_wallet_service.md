# WalletService — Implementation Issue

**Issue:** #002  
**Author:** Bolt (Engineering)  
**Date:** April 2, 2026  
**Status:** Open  
**Blocks:** #003 (DLMMService / position ops)

---

## Summary

Implement `WalletService` in `@lpcli/core` with two signing backends:

- **Primary**: OWS (`@open-wallet-standard/core`) — keys encrypted at rest, signing in isolated memory
- **Fallback**: Raw Solana keypair file (`~/.config/solana/id.json`) for local dev

Also wire up the `lpcli init` command that detects or creates a wallet on first run.

---

## Background

`DLMMService` (position ops) has a hard dependency on `WalletService` — every on-chain operation needs a signer. This is the blocker before any position work can start.

OWS stores keys in `~/.ows/` encrypted with AES-256-GCM. Signing is done via `signTransaction(walletName, "solana", txHex)` — keys are decrypted only during the signing call, then wiped from memory. LPCLI never touches raw key material.

---

## Scope

### 1. `WalletService` class

```typescript
class WalletService {
  static async init(options: WalletOptions): Promise<WalletService>

  getPublicKey(): PublicKey
  async getBalance(): Promise<number>           // lamports via RPC
  async signTx(tx: Transaction): Promise<Transaction>
  async getPriorityFee(txBase64: string): Promise<number>  // Helius
}
```

**Signing backends (in priority order):**

| Backend | When used | How |
|---|---|---|
| OWS | `OWS_WALLET_NAME` env var set + `ows` installed | `signTransaction(name, "solana", txHex)` |
| Keypair file | `PRIVATE_KEY` is a file path (`~` or `/`) | read JSON, decode `Keypair` |
| Keypair base58 | `PRIVATE_KEY` is a base58 string | decode directly |

If none detected → throw a clear error pointing user to `lpcli init`.

**Balance:** RPC `getBalance` call against wallet's public key.

**Priority fee:** POST to Helius RPC with `getPriorityFeeEstimate`. Use `Medium` level by default, `High` for rebalances. If Helius call fails → fall back to `0`.

---

### 2. `lpcli init` command

Interactive setup, run once on first install:

```
$ lpcli init

Checking for existing wallet...
  ✗ No OWS wallet found
  ✗ No keypair file at ~/.config/solana/id.json

How would you like to set up your wallet?
  1. Create new OWS wallet (recommended)
  2. Import existing OWS wallet (mnemonic)
  3. Use existing keypair file

> 1

Creating OWS wallet "lpcli"...
  ✓ Wallet created
  ✓ Address: 7xKp...mQ9f

Enter your Helius RPC URL (or press enter to use public RPC):
> https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

Config saved to ~/.lpcli/config.json
  ✓ Ready. Run `lpcli discover SOL` to get started.
```

**Config file schema** (`~/.lpcli/config.json`):

```json
{
  "rpcUrl": "https://mainnet.helius-rpc.com/?api-key=...",
  "cluster": "mainnet",
  "walletBackend": "ows",
  "owsWalletName": "lpcli"
}
```

---

### 3. `.env` support

```env
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
OWS_WALLET_NAME=lpcli
# or fallback:
PRIVATE_KEY=~/.config/solana/id.json
```

---

## Out of Scope

- OWS API key / agent key management
- Multi-wallet support
- Hardware wallet (Ledger)
- Any position operations — signing infra only

---

## Acceptance Criteria

- [ ] `WalletService.init()` detects OWS wallet if `OWS_WALLET_NAME` is set
- [ ] `WalletService.init()` falls back to keypair file/base58 if OWS not available
- [ ] `WalletService.init()` throws a clear error if no wallet configured
- [ ] `getPublicKey()` returns correct Solana `PublicKey`
- [ ] `getBalance()` returns lamport balance via RPC
- [ ] `signTx()` signs a transaction using whichever backend is active
- [ ] `getPriorityFee()` calls Helius, falls back to `0` on failure
- [ ] `lpcli init` interactive flow creates config at `~/.lpcli/config.json`
- [ ] Unit test: mock OWS + keypair backends, verify correct backend is selected
- [ ] E2E test: sign a real transaction on devnet (no broadcast)
