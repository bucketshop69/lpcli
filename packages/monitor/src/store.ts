// ============================================================================
// Watcher Store — @lpcli/monitor
//
// JSON file-backed persistence for watchers.
// Reads/writes to ~/.lpcli/watchers.json.
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Watcher, Condition, Action } from './types.js';

const STORE_DIR = resolve(homedir(), '.lpcli');
const STORE_FILE = resolve(STORE_DIR, 'watchers.json');

export class WatcherStore {
  private watchers: Map<string, Watcher> = new Map();

  constructor() {
    this.load();
  }

  // --- CRUD ---

  /** Create a new watcher and persist. Returns the watcher with generated ID. */
  add(params: {
    name: string;
    conditions: Condition[];
    action: Action;
    interval: string;
    mode: 'one_shot' | 'repeating';
    cooldownSeconds?: number;
  }): Watcher {
    const watcher: Watcher = {
      id: randomUUID().slice(0, 8),
      name: params.name,
      conditions: params.conditions,
      action: params.action,
      interval: params.interval,
      mode: params.mode,
      cooldownSeconds: params.cooldownSeconds,
      enabled: true,
      createdAt: Date.now(),
      triggerCount: 0,
    };

    this.watchers.set(watcher.id, watcher);
    this.save();
    return watcher;
  }

  /** Get a watcher by ID. */
  get(id: string): Watcher | undefined {
    return this.watchers.get(id);
  }

  /** List all watchers. */
  list(): Watcher[] {
    return [...this.watchers.values()];
  }

  /** List only enabled watchers. */
  listEnabled(): Watcher[] {
    return this.list().filter((w) => w.enabled);
  }

  /** Update a watcher's mutable fields and persist. */
  update(id: string, patch: Partial<Pick<Watcher, 'enabled' | 'lastCheckedAt' | 'lastTriggeredAt' | 'triggerCount' | 'lastError'>>): void {
    const w = this.watchers.get(id);
    if (!w) return;
    Object.assign(w, patch);
    this.save();
  }

  /** Remove a watcher by ID. */
  remove(id: string): boolean {
    const deleted = this.watchers.delete(id);
    if (deleted) this.save();
    return deleted;
  }

  /** Remove all watchers. */
  clear(): void {
    this.watchers.clear();
    this.save();
  }

  // --- Persistence ---

  private load(): void {
    try {
      if (!existsSync(STORE_FILE)) return;
      const raw = readFileSync(STORE_FILE, 'utf-8');
      const arr = JSON.parse(raw) as Watcher[];
      for (const w of arr) {
        this.watchers.set(w.id, w);
      }
    } catch {
      // Corrupt file — start fresh
      this.watchers.clear();
    }
  }

  private save(): void {
    if (!existsSync(STORE_DIR)) {
      mkdirSync(STORE_DIR, { recursive: true });
    }
    writeFileSync(STORE_FILE, JSON.stringify(this.list(), null, 2));
  }
}
