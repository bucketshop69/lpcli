/**
 * qvac.ts — manages QVAC server lifecycle + transcription client.
 *
 * Auto-spawns the QVAC OpenAI server as a background child process
 * on first voice use. Kills it when the TUI exits.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { createRequire } from 'node:module';

const QVAC_PORT = 11435;
const QVAC_BASE = `http://127.0.0.1:${QVAC_PORT}`;

let serverProc: ChildProcess | null = null;
let serverReady = false;
let startingUp = false;

/** Check if QVAC server is reachable with a whisper model loaded. */
async function ping(): Promise<boolean> {
  try {
    const res = await fetch(`${QVAC_BASE}/v1/models`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const json = await res.json() as { data?: Array<{ id: string }> };
    return json.data?.some(m => m.id.toLowerCase().includes('whisper')) ?? false;
  } catch {
    return false;
  }
}

/** Resolve the @qvac/cli entry point from node_modules. */
function resolveQvacCli(): string | null {
  try {
    const require = createRequire(import.meta.url);
    // @qvac/cli exports its main entry which is also the bin
    const resolved = require.resolve('@qvac/cli');
    return existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * Ensure the QVAC server is running. Spawns it if not already up.
 * Returns true when the server is ready, false if it can't be started.
 */
export async function ensureQvacServer(): Promise<boolean> {
  if (serverReady) return true;

  if (await ping()) {
    serverReady = true;
    return true;
  }

  // Prevent double-start
  if (startingUp) {
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (await ping()) { serverReady = true; return true; }
    }
    return false;
  }

  startingUp = true;

  try {
    const cliBin = resolveQvacCli();
    if (!cliBin) return false;

    serverProc = spawn('node', [cliBin, 'serve', 'openai', '--port', String(QVAC_PORT)], {
      stdio: 'ignore',
      detached: false,
    });

    serverProc.on('error', () => { serverProc = null; serverReady = false; });
    serverProc.on('exit', () => { serverProc = null; serverReady = false; });

    // Poll until the server is ready (model download + load can take a while)
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (await ping()) {
        serverReady = true;
        return true;
      }
    }

    killServer();
    return false;
  } finally {
    startingUp = false;
  }
}

/** Kill the QVAC server if we spawned it. */
export function killServer(): void {
  if (serverProc) {
    serverProc.kill('SIGTERM');
    serverProc = null;
    serverReady = false;
  }
}

/** Whether the server is confirmed ready. */
export function isQvacReady(): boolean {
  return serverReady;
}

/**
 * Transcribe an audio file via QVAC's Whisper endpoint.
 * Returns the transcribed text.
 */
export async function transcribeAudio(filePath: string): Promise<string> {
  const audioData = readFileSync(filePath);
  const blob = new Blob([audioData], { type: 'audio/wav' });

  const form = new FormData();
  form.append('file', blob, basename(filePath));
  form.append('model', 'whisper');
  form.append('response_format', 'json');

  const res = await fetch(`${QVAC_BASE}/v1/audio/transcriptions`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`QVAC transcription failed (${res.status}): ${body}`);
  }

  const json = await res.json() as { text: string };
  return json.text?.trim() ?? '';
}
