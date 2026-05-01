/**
 * App — the REPL shell.
 *
 * Scrollable output history + text input at the bottom.
 * All rendering is black and white (bold / dim / normal).
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { AutoInput } from './AutoInput.js';
import { runCommand, getPlaceholder } from './commands.js';
import type { OutputLine } from './commands.js';
import { killServer } from './qvac.js';

// ─────────────────────────────────────────────────────────────────────────────
// Line renderer — converts OutputLine objects to <Text> elements
// ─────────────────────────────────────────────────────────────────────────────

function Line({ line }: { line: OutputLine }) {
  if (line.type === 'blank') {
    return <Text>{' '}</Text>;
  }
  return (
    <Text bold={line.bold} dimColor={line.dim}>
      {line.text}
    </Text>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────────────────────

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;

  const [history, setHistory] = useState<OutputLine[]>(() => header());
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  // Kill QVAC server on unmount (if we spawned it)
  useEffect(() => {
    return () => { killServer(); };
  }, []);

  // Quit on Ctrl+C (also handled by Ink, but be explicit)
  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      killServer();
      exit();
    }
  });

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    setInput('');

    // Echo the user's input
    const echo: OutputLine = { type: 'text', text: `> ${trimmed}`, bold: true };
    const blank: OutputLine = { type: 'blank' };

    if (trimmed === 'q' || trimmed === '/quit' || trimmed === '/exit') {
      exit();
      return;
    }

    setBusy(true);
    setHistory((prev) => [...prev, echo, blank]);

    try {
      const output = await runCommand(trimmed);
      setHistory((prev) => [...prev, ...output, blank]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setHistory((prev) => [
        ...prev,
        { type: 'text', text: `  error: ${msg}`, dim: true },
        blank,
      ]);
    } finally {
      setBusy(false);
    }
  }, [exit]);

  // Reserve rows: input area sits ~15% up from the bottom
  const bottomPadding = Math.max(Math.floor(rows * 0.15), 2);
  const cols = stdout?.columns ?? 80;
  const inputWidth = Math.min(cols - 4, 100); // cap input box width
  const visibleRows = Math.max(rows - bottomPadding - 4, 5); // 4 = border top + input + border bottom + gap
  const visible = history.slice(-visibleRows);

  return (
    <Box flexDirection="column" height={rows}>
      {/* Output area */}
      <Box flexDirection="column" flexGrow={1}>
        {visible.map((line, i) => (
          <Line key={i} line={line} />
        ))}
      </Box>

      {/* Input box */}
      <Box flexDirection="column" paddingLeft={1}>
        <Text dimColor>{'┌' + '─'.repeat(inputWidth) + '┐'}</Text>
        <Box>
          <Text dimColor>{'│ '}</Text>
          {busy ? (
            <Text dimColor>running...</Text>
          ) : (
            <Box width={inputWidth - 2}>
              <AutoInput value={input} onChange={setInput} onSubmit={handleSubmit} placeholder={getPlaceholder()} width={inputWidth - 2} />
            </Box>
          )}
          <Text dimColor>{' │'}</Text>
        </Box>
        <Text dimColor>{'└' + '─'.repeat(inputWidth) + '┘'}</Text>
      </Box>

      {/* Bottom padding */}
      <Box flexDirection="column">
        {Array.from({ length: bottomPadding }, (_, i) => (
          <Text key={i}>{' '}</Text>
        ))}
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header — shown on startup
// ─────────────────────────────────────────────────────────────────────────────

function header(): OutputLine[] {
  return [
    { type: 'text', text: 'lpcli v0.1.0', bold: true },
    { type: 'text', text: 'DeFi terminal for Solana', dim: true },
    { type: 'blank' },
    { type: 'text', text: '  Type /help for commands, or q to quit.', dim: true },
    { type: 'blank' },
  ];
}
