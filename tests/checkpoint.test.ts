import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { checkpointKey, loadCheckpoint, saveCheckpoint, clearCheckpoint } from '../src/checkpoint.js';
import type { CheckpointData } from '../src/checkpoint.js';

// Run tests in a temp directory so they don't pollute the project root
const TEST_CWD = resolve('/tmp/orcaix-checkpoint-tests');
const CHECKPOINT_DIR = join(TEST_CWD, '.orcaix-checkpoints');

// checkpointKey, saveCheckpoint, loadCheckpoint, clearCheckpoint all resolve paths
// from process.cwd(), so we change CWD for the duration of these tests.
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  mkdirSync(TEST_CWD, { recursive: true });
  process.chdir(TEST_CWD);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(TEST_CWD, { recursive: true, force: true });
});

const SAMPLE: CheckpointData = {
  workflowPath: '/project/workflow.yaml',
  workflowName: 'Test Workflow',
  prompt: 'hello',
  startedAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:01:00.000Z',
  stages: { step1: { output: 'done' } },
  vars: { env: 'test' },
  nextIndex: 1,
  currentInput: 'done',
};

// ── checkpointKey ─────────────────────────────────────────────────────────────

describe('checkpointKey', () => {
  it('returns a 16-char hex string', () => {
    const key = checkpointKey('/path/to/wf.yaml', 'prompt');
    expect(key).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic for the same inputs', () => {
    const a = checkpointKey('/path/wf.yaml', 'same prompt');
    const b = checkpointKey('/path/wf.yaml', 'same prompt');
    expect(a).toBe(b);
  });

  it('differs for different prompts', () => {
    const a = checkpointKey('/path/wf.yaml', 'prompt A');
    const b = checkpointKey('/path/wf.yaml', 'prompt B');
    expect(a).not.toBe(b);
  });

  it('differs for different workflow paths', () => {
    const a = checkpointKey('/path/a.yaml', 'prompt');
    const b = checkpointKey('/path/b.yaml', 'prompt');
    expect(a).not.toBe(b);
  });
});

// ── save / load / clear lifecycle ─────────────────────────────────────────────

describe('saveCheckpoint / loadCheckpoint / clearCheckpoint', () => {
  it('returns null when no checkpoint exists', () => {
    const key = checkpointKey('nonexistent.yaml', 'prompt');
    expect(loadCheckpoint(key)).toBeNull();
  });

  it('saves and loads a checkpoint', () => {
    const key = checkpointKey('/project/workflow.yaml', 'hello');
    saveCheckpoint(key, SAMPLE);
    const loaded = loadCheckpoint(key);
    expect(loaded).not.toBeNull();
    expect(loaded!.workflowName).toBe('Test Workflow');
    expect(loaded!.stages.step1.output).toBe('done');
    expect(loaded!.nextIndex).toBe(1);
  });

  it('creates the .orcaix-checkpoints directory if it does not exist', () => {
    const key = checkpointKey('/project/workflow.yaml', 'hello');
    expect(existsSync(CHECKPOINT_DIR)).toBe(false);
    saveCheckpoint(key, SAMPLE);
    expect(existsSync(CHECKPOINT_DIR)).toBe(true);
  });

  it('overwrites an existing checkpoint with updated data', () => {
    const key = checkpointKey('/project/workflow.yaml', 'hello');
    saveCheckpoint(key, SAMPLE);

    const updated = { ...SAMPLE, nextIndex: 5, currentInput: 'new input' };
    saveCheckpoint(key, updated);

    const loaded = loadCheckpoint(key);
    expect(loaded!.nextIndex).toBe(5);
    expect(loaded!.currentInput).toBe('new input');
  });

  it('clears an existing checkpoint', () => {
    const key = checkpointKey('/project/workflow.yaml', 'hello');
    saveCheckpoint(key, SAMPLE);
    expect(loadCheckpoint(key)).not.toBeNull();

    clearCheckpoint(key);
    expect(loadCheckpoint(key)).toBeNull();
  });

  it('does not throw when clearing a non-existent checkpoint', () => {
    const key = checkpointKey('ghost.yaml', 'ghost');
    expect(() => clearCheckpoint(key)).not.toThrow();
  });

  it('preserves all checkpoint fields round-trip', () => {
    const key = checkpointKey('/project/workflow.yaml', 'hello');
    saveCheckpoint(key, SAMPLE);
    const loaded = loadCheckpoint(key)!;

    expect(loaded.workflowPath).toBe(SAMPLE.workflowPath);
    expect(loaded.workflowName).toBe(SAMPLE.workflowName);
    expect(loaded.prompt).toBe(SAMPLE.prompt);
    expect(loaded.startedAt).toBe(SAMPLE.startedAt);
    expect(loaded.updatedAt).toBe(SAMPLE.updatedAt);
    expect(loaded.stages).toEqual(SAMPLE.stages);
    expect(loaded.vars).toEqual(SAMPLE.vars);
    expect(loaded.nextIndex).toBe(SAMPLE.nextIndex);
    expect(loaded.currentInput).toBe(SAMPLE.currentInput);
  });
});
