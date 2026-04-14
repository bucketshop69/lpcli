# Pacifica Perps CLI

Trade perpetual futures on [Pacifica](https://pacifica.fi) via `lpcli perps`.

## Setup

1. Ensure OWS wallet is configured (`lpcli` uses the wallet specified in `config.json`)
2. Deposit USDC to create your Pacifica account (minimum $10)

```bash
lpcli perps deposit 50
```

## Commands

### Account & Positions

```bash
lpcli perps balance                    # Account balance, equity, margin
lpcli perps positions                  # All open positions with live PnL
lpcli perps position SOL               # Detailed view of a single position
```

### Markets & Indicators

```bash
lpcli perps markets                    # Top 10 markets by volume
lpcli perps market BTC                 # Detailed market specs (leverage, lot size, etc.)
lpcli perps rsi SOL                    # 14-period RSI on 15m (default)
lpcli perps rsi BTC 4h                 # RSI on 4h timeframe
```

Supported timeframes: `1m`, `5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `8h`, `12h`, `1d`

RSI zones: >60 overbought, <40 oversold

### Trading

```bash
lpcli perps trade SOL long 0.1         # Market buy 0.1 SOL
lpcli perps trade BTC short 0.001      # Market short 0.001 BTC
lpcli perps close SOL                  # Close your SOL position (auto-detects side & size)
lpcli perps cancel                     # Cancel all open orders
```

### Limit Orders (price-based)

Standard limit orders are sent to Pacifica and executed server-side when price is hit.

```bash
lpcli perps limit SOL long 0.1 --price 80      # Buy 0.1 SOL at $80
lpcli perps limit BTC short 0.001 --price 80000 # Short BTC at $80k
lpcli perps limit SOL close --price 90          # Close SOL position at $90
```

### Conditional Orders (RSI-based)

RSI-triggered orders are watched client-side. The CLI polls RSI at the candle interval
and fires a market order when the condition is met, then exits.

```bash
# Open a position when RSI crosses above 55 on 15m
lpcli perps limit SOL long 0.1 --rsi ">55" --tf 15m

# Open a short when RSI goes above 70 on 1h
lpcli perps limit ETH short 0.1 --rsi ">70" --tf 1h

# Close position when RSI drops below 45 on 15m
lpcli perps limit SOL close --rsi "<45" --tf 15m

# Close position when RSI goes overbought on 4h
lpcli perps limit BTC close --rsi ">65" --tf 4h
```

While watching, the CLI shows live RSI updates:

```
Conditional Order (RSI-triggered, client-side):
  Symbol:    SOL
  Direction: LONG
  Size:      0.1
  Trigger:   RSI > 55 on 15m
  Watching...  (Ctrl+C to cancel)

  [3:45:00 PM] SOL 15m RSI: 52.3 (neutral) — watching
  [3:46:00 PM] SOL 15m RSI: 54.1 (neutral) — watching
  [3:47:00 PM] SOL 15m RSI: 55.8 (neutral) — >>> TRIGGERED <<<

  Condition met! Executing market order...
  Order placed! ID: 12345
  LONG 0.1 SOL
```

Notes:
- Polls at most every 60 seconds (or at candle close for longer timeframes)
- Runs in foreground — Ctrl+C to cancel
- Fires a market order (not limit) when condition triggers
- For `close` direction, auto-detects your position side and size

### Stop-Loss & Take-Profit

Price-based SL/TP orders are managed server-side by Pacifica.

```bash
lpcli perps sl SOL 80                  # Stop-loss at $80
lpcli perps tp SOL 90                  # Take-profit at $90
```

### Deposit & Withdraw

```bash
lpcli perps deposit 100                # Deposit $100 USDC (min $10)
lpcli perps withdraw 50                # Withdraw $50 USDC ($1 fee)
```

## Options

All write commands support `--yes` to skip confirmation prompts:

```bash
lpcli perps trade SOL long 0.1 --yes
lpcli perps deposit 100 --yes
```

## MCP Tools

All perps functionality is also available as MCP tools for AI agents:

| Tool | Description |
|------|-------------|
| `perps_list_markets` | List markets with specs |
| `perps_get_account` | Account balance & margin |
| `perps_get_positions` | Open positions with PnL |
| `perps_execute_trade` | Place market order |
| `perps_close_position` | Close a position |
| `perps_set_sl` | Set stop-loss |
| `perps_set_tp` | Set take-profit |
| `perps_deposit` | Deposit USDC |
| `perps_withdraw` | Withdraw USDC |

Add the MCP server: `claude mcp add lpcli npx @lpcli/mcp`
