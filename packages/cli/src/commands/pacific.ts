/**
 * `lpcli pacific` — Pacifica perpetuals command namespace.
 *
 * Usage:
 *   lpcli pacific balance                             Show account balance & margin
 *   lpcli pacific positions                           List open positions with PnL
 *   lpcli pacific position <symbol>                   Detailed view of a position
 *   lpcli pacific markets                             List all available markets
 *   lpcli pacific market <symbol>                     Detailed view of a market
 *   lpcli pacific deposit <amount>                    Deposit USDC to Pacifica
 *   lpcli pacific withdraw <amount>                   Withdraw USDC from Pacifica
 *   lpcli pacific trade <symbol> <long|short> <size>  Place a market order
 *   lpcli pacific close <symbol>                      Close an open position
 *   lpcli pacific cancel [symbol]                     Cancel open orders
 *   lpcli pacific limit ...                           Limit / RSI conditional orders (timeframe as positional or --tf)
 *   lpcli pacific rsi <symbol> [timeframe]            RSI indicator
 *   lpcli pacific sl <symbol> <price>                 Set stop-loss
 *   lpcli pacific tp <symbol> <price>                 Set take-profit
 */

import { runPerps } from './perps.js';

export async function runPacific(args: string[]): Promise<void> {
  await runPerps(args);
}
