/**
 * AutoInput — text input with ghost-text autocomplete, Tab completion,
 * and up/down arrow command history.
 *
 * - Ghost text: dimmed suggestion after cursor, Tab to accept
 * - History: up/down arrows cycle through previous submissions
 * - Contextual placeholders
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { startRecording, stopRecording, cleanupRecording, detectRecorder } from './voice.js';
import { transcribeAudio, ensureQvacServer } from './qvac.js';

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
  '/transfer',
  '/private',
  '/private fund',
  '/private balance',
  '/private health',
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

// ─────────────────────────────────────────────────────────────────────────────
// Voice state — push-to-talk via long-press Space
//
// How it works:
//   1. First space press → start a 500ms hold timer, insert space normally
//   2. More spaces arrive (key repeat from holding) → keep counting
//   3. Timer fires and we got ≥2 spaces → held! Remove spaces, start recording
//   4. Timer fires but only 1 space → was a normal tap, do nothing
//   5. Non-space key before timer → cancel, was just typing
//   6. While recording: spaces stop arriving (key released) → stop & transcribe
// ─────────────────────────────────────────────────────────────────────────────

type VoiceState = 'idle' | 'holding' | 'recording' | 'transcribing';

const HOLD_DELAY_MS = 500;

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

  // Voice input state
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spaceCount = useRef(0);
  const valueBeforeHold = useRef('');

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
    };
  }, []);

  const cancelHold = useCallback(() => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    spaceCount.current = 0;
    setVoiceState('idle');
  }, []);

  const activateVoice = useCallback(() => {
    // Revert the spaces inserted during the hold detection
    onChange(valueBeforeHold.current);
    spaceCount.current = 0;
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }

    if (!detectRecorder()) {
      onChange('[install sox or arecord for voice input]');
      setVoiceState('idle');
      return;
    }

    const started = startRecording();
    if (!started) {
      onChange('[could not start recording]');
      setVoiceState('idle');
      return;
    }

    setVoiceState('recording');
  }, [onChange]);

  // Stop recording: ensure QVAC is up, send audio, insert result into input
  const finishRecording = useCallback(async () => {
    if (releaseTimer.current) { clearTimeout(releaseTimer.current); releaseTimer.current = null; }
    const filePath = stopRecording();
    if (!filePath) {
      setVoiceState('idle');
      return;
    }

    setVoiceState('transcribing');
    try {
      const ready = await ensureQvacServer();
      if (!ready) {
        onChange('[qvac not available — run: npm i @qvac/sdk @qvac/cli]');
        cleanupRecording(filePath);
        setVoiceState('idle');
        return;
      }

      const text = await transcribeAudio(filePath);
      if (text) {
        onChange(text.toLowerCase());
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onChange(`[voice error: ${msg}]`);
    } finally {
      cleanupRecording(filePath);
      setVoiceState('idle');
    }
  }, [onChange]);

  useInput((input, key) => {
    // ── While recording: detect key release to stop ─────────────────
    if (voiceState === 'recording') {
      if (input === ' ') {
        // Space still held (key repeat) → reset the release debounce
        if (releaseTimer.current) clearTimeout(releaseTimer.current);
        releaseTimer.current = setTimeout(() => {
          // Spaces stopped arriving → key released → stop recording
          finishRecording();
        }, 300);
        return;
      }
      // Non-space key pressed → stop recording immediately
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
      finishRecording();
      return;
    }

    // ── While transcribing: ignore all input ────────────────────────
    if (voiceState === 'transcribing') return;

    // ── Holding state: accumulate spaces, non-space cancels ─────────
    if (voiceState === 'holding') {
      if (input === ' ' && !key.ctrl && !key.meta) {
        spaceCount.current++;
        // Don't insert more spaces — we're in hold detection
        return;
      }
      // Non-space key → cancel hold, insert the accumulated spaces + this char
      const spaces = ' '.repeat(spaceCount.current);
      cancelHold();
      if (key.return) {
        onChange(valueBeforeHold.current + spaces);
        if ((valueBeforeHold.current + spaces).trim()) {
          pushHistory((valueBeforeHold.current + spaces).trim());
        }
        stashRef.current = '';
        setHistIdx(-1);
        onSubmit(valueBeforeHold.current + spaces);
        return;
      }
      if (key.backspace || key.delete) {
        // Just restore the value without the trailing spaces
        onChange(valueBeforeHold.current);
        return;
      }
      if (input && !key.ctrl && !key.meta && !key.escape) {
        onChange(valueBeforeHold.current + spaces + input);
        return;
      }
      onChange(valueBeforeHold.current + spaces);
      return;
    }

    // ── Idle state ──────────────────────────────────────────────────

    // Space — start hold detection
    if (input === ' ' && !key.ctrl && !key.meta) {
      valueBeforeHold.current = value;
      spaceCount.current = 1;
      setVoiceState('holding');

      // After HOLD_DELAY_MS: if we got repeated spaces → voice mode
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        if (spaceCount.current >= 2) {
          // Held long enough — key repeat happened → activate voice
          activateVoice();
        } else {
          // Single tap — just insert the space normally
          onChange(valueBeforeHold.current + ' ');
          spaceCount.current = 0;
          setVoiceState('idle');
        }
      }, HOLD_DELAY_MS);

      return;
    }

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

  // ── Voice mode rendering ──────────────────────────────────────────
  if (voiceState === 'holding') {
    return (
      <Box width={width}>
        <Text>{valueBeforeHold.current}</Text>
        <Text dimColor> hold space for voice...</Text>
      </Box>
    );
  }

  if (voiceState === 'recording') {
    return (
      <Box width={width}>
        <Text bold color="red">{'● '}</Text>
        <Text>listening... </Text>
        <Text dimColor>release space to finish</Text>
      </Box>
    );
  }

  if (voiceState === 'transcribing') {
    return (
      <Box width={width}>
        <Text dimColor>transcribing...</Text>
      </Box>
    );
  }

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
