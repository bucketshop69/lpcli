/**
 * AutoInput — text input with ghost-text autocomplete, Tab completion,
 * and up/down arrow command history.
 *
 * - Ghost text: dimmed suggestion after cursor, Tab to accept
 * - History: up/down arrows cycle through previous submissions
 * - Contextual placeholders
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import { Box, Text, useInput } from 'ink';

// ─────────────────────────��─────────────────────────────────────────���─────────
// Command tree for autocomplete
// ─��─────────────────────────────────────────────────────────────────���─────────

const COMMANDS: string[] = [
  '/help',
  '/status',
  '/wallet',
  '/wallet address',
  '/wallet balance',
  '/meteora',
  '/meteora positions',
  '/meteora discover',
  '/meteora open',
  '/meteora close',
  '/meteora claim',
  '/pacific',
  '/pacific positions',
  '/pacific balance',
  '/pacific markets',
  '/pacific trade',
  '/pacific close',
  '/pacific cancel',
  '/pacific deposit',
  '/pacific withdraw',
  '/pacific rsi',
  '/pacific sl',
  '/pacific tp',
  '/monitor',
  '/monitor list',
  '/mp',
  '/pp',
  '/cancel',
];

function findSuggestion(input: string): string | undefined {
  if (!input || !input.startsWith('/')) return undefined;

  const lower = input.toLowerCase();

  // Exact match — no suggestion needed
  const exact = COMMANDS.find((c) => c === lower);
  if (exact) {
    const subs = COMMANDS.filter((c) => c.startsWith(lower + ' '));
    if (subs.length > 0) return undefined;
    return undefined;
  }

  // Prefix match
  const match = COMMANDS.find((c) => c.startsWith(lower));
  if (match) return match;

  return undefined;
}

// ───��─────���──────────────────────────────���────────────────────────────────────
// History — module-level so it persists across re-renders
// ────────────────��────────────────────────────────────────────────────────────

const history: string[] = [];
const MAX_HISTORY = 50;

function pushHistory(entry: string) {
  // Don't duplicate the last entry
  if (history.length > 0 && history[history.length - 1] === entry) return;
  history.push(entry);
  if (history.length > MAX_HISTORY) history.shift();
}

// ───��─────────────────────────────────────────────────────────���───────────────
// Component
// ─────────��───────────────────��─────────────────────────��─────────────────────

interface AutoInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  width: number;
}

export function AutoInput({ value, onChange, onSubmit, placeholder, width }: AutoInputProps) {
  const suggestion = useMemo(() => findSuggestion(value), [value]);
  const ghost = suggestion ? suggestion.slice(value.length) : '';

  // History navigation index: -1 means "not browsing history" (current input)
  const [histIdx, setHistIdx] = useState(-1);
  // Stash whatever the user was typing before they started arrowing through history
  const stashRef = useRef('');

  useInput((input, key) => {
    // Tab — accept suggestion
    if (key.tab && suggestion) {
      onChange(suggestion);
      setHistIdx(-1);
      return;
    }

    // Enter — submit
    if (key.return) {
      if (value.trim()) {
        pushHistory(value.trim());
      }
      setHistIdx(-1);
      stashRef.current = '';
      onSubmit(value);
      return;
    }

    // Up arrow — go back in history
    if (key.upArrow) {
      if (history.length === 0) return;

      if (histIdx === -1) {
        // Entering history — stash current input
        stashRef.current = value;
      }

      const newIdx = histIdx === -1
        ? history.length - 1
        : Math.max(0, histIdx - 1);

      setHistIdx(newIdx);
      onChange(history[newIdx]);
      return;
    }

    // Down arrow — go forward in history
    if (key.downArrow) {
      if (histIdx === -1) return; // not browsing history

      if (histIdx >= history.length - 1) {
        // Back to current input
        setHistIdx(-1);
        onChange(stashRef.current);
        return;
      }

      const newIdx = histIdx + 1;
      setHistIdx(newIdx);
      onChange(history[newIdx]);
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      setHistIdx(-1);
      onChange(value.slice(0, -1));
      return;
    }

    // Ignore control keys
    if (key.ctrl || key.meta || key.escape) return;
    if (key.leftArrow || key.rightArrow) return;

    // Regular character — reset history browsing
    if (input) {
      setHistIdx(-1);
      onChange(value + input);
    }
  });

  // Empty state — show placeholder
  if (!value && !ghost) {
    return (
      <Box width={width}>
        <Text dimColor>{placeholder || ''}</Text>
      </Box>
    );
  }

  return (
    <Box width={width}>
      <Text>{value}</Text>
      <Text dimColor>{ghost}</Text>
      <Text>{'█'}</Text>
    </Box>
  );
}
