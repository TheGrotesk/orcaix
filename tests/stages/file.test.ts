import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import { executeFileStage } from '../../src/stages/file.js';
import { createContext } from '../../src/context.js';
import type { FileStage } from '../../src/types.js';
import type { ExecutionContext } from '../../src/context.js';

const TMP = resolve('/tmp/aiac-file-stage-tests');

let ctx: ExecutionContext;

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
  ctx = createContext('the current input', { myVar: 'VAR' }, {});
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function stage(overrides: Partial<FileStage> & Pick<FileStage, 'action'>): FileStage {
  return {
    id: 'test-file',
    type: 'file',
    path: join(TMP, 'test.txt'),
    encoding: 'utf-8',
    ...overrides,
  } as FileStage;
}

// ── write ─────────────────────────────────────────────────────────────────────

describe('executeFileStage — write', () => {
  it('writes content to disk and returns a confirmation message', async () => {
    const s = stage({ action: 'write', content: 'hello world' });
    const result = await executeFileStage(s, ctx, 'unused');
    expect(result).toMatch(/Written to/);
    expect(readFileSync(s.path, 'utf-8')).toBe('hello world');
  });

  it('uses currentInput as content when content field is absent', async () => {
    const s = stage({ action: 'write' });
    await executeFileStage(s, ctx, 'from input');
    expect(readFileSync(s.path, 'utf-8')).toBe('from input');
  });

  it('interpolates {{input}} inside content', async () => {
    const s = stage({ action: 'write', content: 'Result: {{input}}' });
    await executeFileStage(s, ctx, 'my result');
    expect(readFileSync(s.path, 'utf-8')).toBe('Result: my result');
  });

  it('interpolates {{vars.KEY}} inside content', async () => {
    const s = stage({ action: 'write', content: 'var={{vars.myVar}}' });
    await executeFileStage(s, ctx, 'unused');
    expect(readFileSync(s.path, 'utf-8')).toBe('var=VAR');
  });

  it('creates intermediate directories automatically', async () => {
    const deepPath = join(TMP, 'a', 'b', 'c', 'file.txt');
    const s = stage({ action: 'write', path: deepPath, content: 'deep' });
    await executeFileStage(s, ctx, 'unused');
    expect(readFileSync(deepPath, 'utf-8')).toBe('deep');
  });

  it('interpolates {{timestamp}} in path', async () => {
    const s = stage({ action: 'write', path: join(TMP, '{{timestamp}}.txt'), content: 'ts' });
    const result = await executeFileStage(s, ctx, 'unused');
    expect(result).toContain(TMP);
    // The written file should exist (path was resolved using actual timestamp from ctx)
    expect(result).toMatch(/Written to .+\.txt/);
  });
});

// ── read ──────────────────────────────────────────────────────────────────────

describe('executeFileStage — read', () => {
  it('reads file contents and returns them as output', async () => {
    const filePath = join(TMP, 'input.txt');
    writeFileSync(filePath, 'file contents here', 'utf-8');

    const s = stage({ action: 'read', path: filePath });
    const result = await executeFileStage(s, ctx, 'unused');
    expect(result).toBe('file contents here');
  });

  it('throws when reading a non-existent file', async () => {
    const s = stage({ action: 'read', path: join(TMP, 'ghost.txt') });
    await expect(executeFileStage(s, ctx, 'unused')).rejects.toThrow();
  });
});

// ── append ────────────────────────────────────────────────────────────────────

describe('executeFileStage — append', () => {
  it('appends content to an existing file', async () => {
    const filePath = join(TMP, 'log.txt');
    writeFileSync(filePath, 'line 1\n', 'utf-8');

    const s = stage({ action: 'append', path: filePath, content: 'line 2\n' });
    await executeFileStage(s, ctx, 'unused');
    expect(readFileSync(filePath, 'utf-8')).toBe('line 1\nline 2\n');
  });

  it('creates the file if it does not exist', async () => {
    const filePath = join(TMP, 'new.txt');
    const s = stage({ action: 'append', path: filePath, content: 'created' });
    await executeFileStage(s, ctx, 'unused');
    expect(readFileSync(filePath, 'utf-8')).toBe('created');
  });

  it('returns a confirmation message', async () => {
    const filePath = join(TMP, 'log.txt');
    const s = stage({ action: 'append', path: filePath, content: 'data' });
    const result = await executeFileStage(s, ctx, 'unused');
    expect(result).toMatch(/Appended to/);
  });

  it('uses currentInput when content field is absent', async () => {
    const filePath = join(TMP, 'log.txt');
    const s = stage({ action: 'append', path: filePath });
    await executeFileStage(s, ctx, 'appended input');
    expect(readFileSync(filePath, 'utf-8')).toBe('appended input');
  });
});
