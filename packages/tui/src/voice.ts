/**
 * voice.ts — mic recording via sox or arecord.
 *
 * Records to a temp .wav file, returns the path when stopped.
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';

type Recorder = 'sox' | 'arecord' | null;

let detected: Recorder | undefined;

/** Detect which recording tool is available. */
export function detectRecorder(): Recorder {
  if (detected !== undefined) return detected;

  for (const cmd of ['sox', 'arecord'] as const) {
    try {
      execSync(`which ${cmd}`, { stdio: 'ignore' });
      detected = cmd;
      return detected;
    } catch {
      // not found
    }
  }

  detected = null;
  return null;
}

interface RecordingHandle {
  proc: ChildProcess;
  filePath: string;
}

let active: RecordingHandle | null = null;

/** Start recording from the default mic. Returns false if no recorder available. */
export function startRecording(): boolean {
  if (active) return true; // already recording

  const recorder = detectRecorder();
  if (!recorder) return false;

  const filePath = join(tmpdir(), `lpcli-voice-${Date.now()}.wav`);

  let proc: ChildProcess;

  if (recorder === 'sox') {
    // sox: rec outputs to file, 16kHz mono (whisper expects this)
    proc = spawn('sox', [
      '-d',                  // default audio device
      '-r', '16000',         // 16kHz sample rate
      '-c', '1',             // mono
      '-b', '16',            // 16-bit
      filePath,
    ], { stdio: 'ignore' });
  } else {
    // arecord: Linux ALSA
    proc = spawn('arecord', [
      '-f', 'S16_LE',        // 16-bit signed little-endian
      '-r', '16000',         // 16kHz
      '-c', '1',             // mono
      '-t', 'wav',           // WAV format
      filePath,
    ], { stdio: 'ignore' });
  }

  active = { proc, filePath };
  return true;
}

/** Stop recording. Returns the path to the recorded .wav file, or null. */
export function stopRecording(): string | null {
  if (!active) return null;

  const { proc, filePath } = active;
  active = null;

  // Send SIGINT for graceful stop (finalizes WAV header)
  proc.kill('SIGINT');

  return filePath;
}

/** Clean up a temp recording file. */
export function cleanupRecording(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // ignore
  }
}

/** Whether we're currently recording. */
export function isRecording(): boolean {
  return active !== null;
}
