/**
 * `lpcli transfer` — interactive token transfer (public or private).
 *
 * Shows all tokens (SOL + SPL) in wallet, lets user pick one,
 * enter recipient and amount, choose visibility, then confirm and send.
 *
 * Private transfers use MagicBlock PERs — no on-chain link between
 * sender and recipient. Currently supports SPL tokens only (not native SOL).
 *
 * Flags:
 *   --private    Skip the visibility prompt and use private mode
 *   --public     Skip the visibility prompt and use public mode
 */

import { LPCLI, TokenRegistry, executePrivateTransfer } from '@lpcli/core';
import { createRL, ask, shortAddr, solscanTxUrl, hasFlag } from '../helpers.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

export async function runTransfer(args: string[]): Promise<void> {
  const forcePrivate = hasFlag(args, '--private');
  const forcePublic = hasFlag(args, '--public');

  const lpcli = new LPCLI();
  const wallet = await lpcli.getWallet();
  const balances = await wallet.getBalances();
  const registry = new TokenRegistry(wallet.getConnection());

  // Build token list: SOL first, then SPL tokens
  interface TokenOption {
    label: string;
    mint: string;       // 'SOL' for native SOL
    uiAmount: number;
    decimals: number;
  }

  const options: TokenOption[] = [];

  // SOL
  if (balances.solBalance > 0) {
    options.push({
      label: `SOL`,
      mint: 'SOL',
      uiAmount: balances.solBalance,
      decimals: 9,
    });
  }

  // Resolve SPL token symbols
  if (balances.tokens.length > 0) {
    const mints = balances.tokens.map((t) => t.mint);
    await registry.resolve(mints);

    for (const t of balances.tokens) {
      const info = registry.getCached(t.mint);
      const symbol = info?.symbol?.toUpperCase() ?? t.mint.slice(0, 6);
      options.push({
        label: symbol,
        mint: t.mint,
        uiAmount: t.uiAmount,
        decimals: t.decimals,
      });
    }
  }

  if (options.length === 0) {
    console.log('\nNo tokens in wallet. Nothing to transfer.\n');
    return;
  }

  // Display token list
  console.log('\nWallet tokens:');
  console.log('─'.repeat(50));
  for (let i = 0; i < options.length; i++) {
    const o = options[i];
    const mintDisplay = o.mint === 'SOL' ? '' : ` (${shortAddr(o.mint, 4, 4)})`;
    console.log(`  [${i + 1}] ${o.label.padEnd(8)} ${o.uiAmount}${mintDisplay}`);
  }
  console.log('');

  const rl = createRL();

  try {
    // Pick token
    const choice = await ask(rl, 'Select token [number]: ');
    const idx = parseInt(choice, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= options.length) {
      console.log('Invalid selection.');
      return;
    }
    const selected = options[idx];

    // Recipient
    const recipient = await ask(rl, 'Recipient address: ');
    if (!recipient || recipient.length < 32) {
      console.log('Invalid address.');
      return;
    }

    // Amount
    const amountStr = await ask(rl, `Amount (max ${selected.uiAmount} ${selected.label}): `);
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      console.log('Invalid amount.');
      return;
    }
    if (amount > selected.uiAmount) {
      console.log(`Insufficient balance. Have: ${selected.uiAmount} ${selected.label}`);
      return;
    }

    // Visibility — ask unless forced via flag
    let visibility: 'public' | 'private' = 'public';

    if (forcePrivate) {
      visibility = 'private';
    } else if (forcePublic) {
      visibility = 'public';
    } else if (selected.mint !== 'SOL') {
      // Private transfers only supported for SPL tokens (not native SOL)
      const visChoice = await ask(rl, 'Visibility: [1] public  [2] private (MagicBlock PER): ');
      if (visChoice === '2' || visChoice.toLowerCase() === 'private') {
        visibility = 'private';
      }
    }

    // Private mode not available for native SOL
    if (visibility === 'private' && selected.mint === 'SOL') {
      console.log('Private transfers are only supported for SPL tokens (not native SOL).');
      console.log('Falling back to public transfer.');
      visibility = 'public';
    }

    // Confirm
    console.log(`\nTransfer:`);
    console.log(`  Token:      ${selected.label}`);
    console.log(`  Amount:     ${amount} ${selected.label}`);
    console.log(`  To:         ${recipient}`);
    console.log(`  From:       ${balances.address}`);
    console.log(`  Visibility: ${visibility}${visibility === 'private' ? ' (via MagicBlock PER)' : ''}`);
    console.log('');

    const confirm = await ask(rl, 'Confirm? [y/N] ');
    if (confirm.toLowerCase() !== 'y') {
      console.log('Aborted.');
      return;
    }

    // Execute
    if (visibility === 'private') {
      console.log('\nBuilding private transfer via MagicBlock PER...');

      const result = await executePrivateTransfer(wallet, {
        to: recipient,
        amount,
        mint: selected.mint,
      });

      console.log(`\nSent ${amount} ${selected.label} (private)`);
      console.log(`  TX: ${solscanTxUrl(result.txSignature)}`);
      console.log(`  No on-chain link between sender and recipient.\n`);
    } else if (selected.mint === 'SOL') {
      const result = await wallet.transferSOL(recipient, amount);
      console.log(`\nSent ${amount} SOL`);
      console.log(`  ${solscanTxUrl(result.signature)}\n`);
    } else {
      // Public SPL transfer
      const rawAmount = Math.round(amount * 10 ** selected.decimals);
      const result = await wallet.transferToken({ to: recipient, mint: selected.mint, amount: rawAmount });
      console.log(`\nSent ${amount} ${selected.label}`);
      console.log(`  ${solscanTxUrl(result.signature)}\n`);
    }
  } finally {
    rl.close();
  }
}
