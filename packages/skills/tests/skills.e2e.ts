/**
 * @lpcli/skills E2E Tests
 *
 * Validates that all skill files exist, have proper YAML frontmatter,
 * and contain required sections.
 *
 * Run with: pnpm --filter @lpcli/skills test:e2e
 *
 * No network access, no wallet needed — pure file validation.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Helper: parse SKILL.md frontmatter
// ---------------------------------------------------------------------------

interface SkillFrontmatter {
  name: string;
  description: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

function parseSkillMd(filePath: string): { frontmatter: SkillFrontmatter; body: string } {
  const content = readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(match, `${filePath}: should have YAML frontmatter between --- delimiters`);

  const yamlBlock = match[1];
  const body = match[2];

  // Simple YAML parser for flat keys (no nested objects needed for validation)
  const frontmatter: Record<string, unknown> = {};
  for (const line of yamlBlock.split('\n')) {
    const kvMatch = line.match(/^(\w+):\s*(.+)$/);
    if (kvMatch) {
      let value: unknown = kvMatch[2].trim();
      // Strip quotes
      if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      frontmatter[kvMatch[1]] = value;
    }
  }

  return {
    frontmatter: frontmatter as unknown as SkillFrontmatter,
    body,
  };
}

// ---------------------------------------------------------------------------
// Expected skills
// ---------------------------------------------------------------------------

const EXPECTED_SKILLS = [
  {
    dir: 'lpcli',
    name: 'lpcli',
    requiredSections: ['Available Tools', 'Strategy Guide', 'CLI Usage'],
  },
  {
    dir: 'meteora',
    name: 'meteora-dlmm',
    requiredSections: ['What is DLMM', 'Strategies', 'Program Addresses', 'SDK Reference'],
  },
  {
    dir: 'helius',
    name: 'helius-solana',
    requiredSections: ['Priority Fees', 'Transaction Sending', 'Balance Checks'],
  },
  {
    dir: 'jupiter',
    name: 'jupiter-for-lp',
    requiredSections: ['Price API', 'Ultra Swap API', 'Token Metadata'],
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Skills — Package Skills', { concurrency: false }, () => {

  test('all 4 skill directories exist', () => {
    for (const skill of EXPECTED_SKILLS) {
      const skillPath = resolve(SKILLS_DIR, skill.dir, 'SKILL.md');
      assert.ok(existsSync(skillPath), `${skill.dir}/SKILL.md should exist`);
    }
    console.log('  ✓ All 4 SKILL.md files exist');
  });

  for (const skill of EXPECTED_SKILLS) {
    test(`${skill.dir}/SKILL.md — has valid frontmatter`, () => {
      const skillPath = resolve(SKILLS_DIR, skill.dir, 'SKILL.md');
      const { frontmatter } = parseSkillMd(skillPath);

      assert.ok(frontmatter.name, 'frontmatter must have name');
      assert.strictEqual(frontmatter.name, skill.name, `name should be "${skill.name}"`);
      assert.ok(frontmatter.description, 'frontmatter must have description');
      assert.ok(
        frontmatter.description.length >= 20,
        `description should be descriptive (got ${frontmatter.description.length} chars)`
      );

      console.log(`  ✓ ${skill.dir}: name="${frontmatter.name}", description OK`);
    });

    test(`${skill.dir}/SKILL.md — has required sections`, () => {
      const skillPath = resolve(SKILLS_DIR, skill.dir, 'SKILL.md');
      const { body } = parseSkillMd(skillPath);

      for (const section of skill.requiredSections) {
        assert.ok(
          body.includes(`## ${section}`) || body.includes(`# ${section}`),
          `should contain section: "${section}"`
        );
      }

      console.log(`  ✓ ${skill.dir}: all required sections present (${skill.requiredSections.join(', ')})`);
    });
  }

  test('lpcli skill — documents all 6 tools', () => {
    const skillPath = resolve(SKILLS_DIR, 'lpcli', 'SKILL.md');
    const { body } = parseSkillMd(skillPath);

    const tools = ['discover_pools', 'get_pool_info', 'get_positions', 'open_position', 'close_position', 'claim_fees'];
    for (const tool of tools) {
      assert.ok(body.includes(tool), `lpcli skill should document tool: ${tool}`);
    }

    console.log('  ✓ lpcli skill documents all 6 tools');
  });

  test('lpcli skill — documents x402 payment flow', () => {
    const skillPath = resolve(SKILLS_DIR, 'lpcli', 'SKILL.md');
    const { body } = parseSkillMd(skillPath);

    assert.ok(body.includes('402'), 'should mention 402 status code');
    assert.ok(body.includes('2 b') || body.includes('2 bps') || body.includes('0.02%'), 'should mention fee rate');
    assert.ok(body.includes('x-402'), 'should mention x402 headers');

    console.log('  ✓ lpcli skill documents x402 payment flow');
  });

  test('meteora skill — includes program addresses', () => {
    const skillPath = resolve(SKILLS_DIR, 'meteora', 'SKILL.md');
    const { body } = parseSkillMd(skillPath);

    assert.ok(
      body.includes('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'),
      'should include DLMM program address'
    );

    console.log('  ✓ Meteora skill includes DLMM program address');
  });

  test('jupiter skill — includes common token mints', () => {
    const skillPath = resolve(SKILLS_DIR, 'jupiter', 'SKILL.md');
    const { body } = parseSkillMd(skillPath);

    assert.ok(
      body.includes('So11111111111111111111111111111111111111112'),
      'should include SOL mint'
    );
    assert.ok(
      body.includes('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
      'should include USDC mint'
    );

    console.log('  ✓ Jupiter skill includes SOL and USDC mints');
  });
});

// ---------------------------------------------------------------------------
// OpenClaw skill
// ---------------------------------------------------------------------------

describe('Skills — OpenClaw Skill', { concurrency: false }, () => {
  const OPENCLAW_SKILL = resolve(process.env['HOME'] ?? '~', '.openclaw/workspace/skills/lpcli/SKILL.md');

  test('OpenClaw skill exists', () => {
    assert.ok(existsSync(OPENCLAW_SKILL), 'OpenClaw skill should exist at ~/.openclaw/workspace/skills/lpcli/SKILL.md');
    console.log('  ✓ OpenClaw skill file exists');
  });

  test('OpenClaw skill has valid frontmatter', () => {
    const { frontmatter } = parseSkillMd(OPENCLAW_SKILL);
    assert.strictEqual(frontmatter.name, 'lpcli');
    assert.ok(frontmatter.description);

    console.log('  ✓ OpenClaw skill: name="lpcli"');
  });

  test('OpenClaw skill documents CLI commands', () => {
    const { body } = parseSkillMd(OPENCLAW_SKILL);

    const commands = ['lpcli discover', 'lpcli pool', 'lpcli positions', 'lpcli open', 'lpcli close', 'lpcli claim'];
    for (const cmd of commands) {
      assert.ok(body.includes(cmd), `should document command: ${cmd}`);
    }

    console.log('  ✓ OpenClaw skill documents all CLI commands');
  });
});
