/**
 * @lpcli/cli — CLI entry point
 *
 * TODO: Implement all commands:
 * - lpcli init        → onboarding wizard
 * - lpcli discover    → pool discovery (wrapper around @lpcli/core)
 * - lpcli pool        → pool details
 * - lpcli open        → open position
 * - lpcli positions   → list positions
 * - lpcli position    → single position
 * - lpcli close       → close position
 * - lpcli claim       → claim fees
 * - lpcli swap        → token swap
 * - lpcli serve       → MCP server mode
 * - lpcli connect     → wire into OpenClaw / Telegram
 */

import { Command } from 'commander';

const program = new Command();

program
  .name('lpcli')
  .description('CLI-first LP management for Meteora DLMM on Solana')
  .version('0.1.0');

program
  .command('discover')
  .description('Discover and rank DLMM pools')
  .argument('[token]', 'Token symbol to search for (e.g., SOL, BTC)')
  .option('--sort <key>', 'Sort by: score, fee_yield, volume, tvl', 'score')
  .option('--top <n>', 'Number of pools to return', '10')
  .action(async (token, options) => {
    console.log('TODO: implement discover — build core first');
    console.log({ token, options });
  });

program
  .command('init')
  .description('Initialize LPCLI with wallet and RPC config')
  .action(() => {
    console.log('TODO: implement init wizard');
  });

program
  .command('serve')
  .description('Start LPCLI as an MCP server (stdio or HTTP)')
  .option('--http <port>', 'Start as HTTP server on port', '0')
  .action((options) => {
    console.log('TODO: implement MCP server — depends on core + mcp package');
    console.log({ options });
  });

program.parse();
