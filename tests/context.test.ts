import { describe, it, expect, beforeEach } from 'vitest';
import { createContext, interpolate, interpolateDeep } from '../src/context.js';
import type { ExecutionContext } from '../src/context.js';

// ── createContext ─────────────────────────────────────────────────────────────

describe('createContext', () => {
  it('sets input to the provided prompt', () => {
    const ctx = createContext('hello world');
    expect(ctx.input).toBe('hello world');
  });

  it('starts with empty stages', () => {
    const ctx = createContext('test');
    expect(ctx.stages).toEqual({});
  });

  it('copies vars into context', () => {
    const ctx = createContext('test', { FOO: 'bar', NUM: '42' });
    expect(ctx.vars.FOO).toBe('bar');
    expect(ctx.vars.NUM).toBe('42');
  });

  it('copies templates into context', () => {
    const ctx = createContext('test', {}, { persona: 'You are an expert.' });
    expect(ctx.templates.persona).toBe('You are an expert.');
  });

  it('includes process.env entries', () => {
    process.env.AIAC_TEST_VAR = 'sentinel';
    const ctx = createContext('test');
    expect(ctx.env.AIAC_TEST_VAR).toBe('sentinel');
    delete process.env.AIAC_TEST_VAR;
  });

  it('produces a timestamp string safe for filenames (no colons)', () => {
    const ctx = createContext('test');
    expect(ctx.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
  });
});

// ── interpolate ───────────────────────────────────────────────────────────────

describe('interpolate', () => {
  let ctx: ExecutionContext;

  beforeEach(() => {
    ctx = createContext('initial prompt', { myVar: 'varValue' }, { myTpl: 'template text' });
    ctx.stages['prev'] = { output: 'prev output' };
    ctx.env['MY_ENV'] = 'envValue';
  });

  it('replaces {{input}} with currentInput when provided', () => {
    expect(interpolate('Hello {{input}}', ctx, 'world')).toBe('Hello world');
  });

  it('falls back to ctx.input when currentInput is omitted', () => {
    expect(interpolate('{{input}}', ctx)).toBe('initial prompt');
  });

  it('replaces {{timestamp}}', () => {
    expect(interpolate('ts={{timestamp}}', ctx)).toBe(`ts=${ctx.timestamp}`);
  });

  it('replaces {{env.KEY}}', () => {
    expect(interpolate('env={{env.MY_ENV}}', ctx)).toBe('env=envValue');
  });

  it('returns empty string for missing env key', () => {
    expect(interpolate('{{env.NONEXISTENT_KEY_XYZ}}', ctx)).toBe('');
  });

  it('replaces {{vars.KEY}}', () => {
    expect(interpolate('var={{vars.myVar}}', ctx)).toBe('var=varValue');
  });

  it('returns empty string for missing vars key', () => {
    expect(interpolate('{{vars.missing}}', ctx)).toBe('');
  });

  it('replaces {{templates.name}}', () => {
    expect(interpolate('tpl={{templates.myTpl}}', ctx)).toBe('tpl=template text');
  });

  it('returns empty string for missing template key', () => {
    expect(interpolate('{{templates.missing}}', ctx)).toBe('');
  });

  it('replaces {{stages.id.output}}', () => {
    expect(interpolate('out={{stages.prev.output}}', ctx)).toBe('out=prev output');
  });

  it('returns empty string for unknown stage id', () => {
    expect(interpolate('{{stages.missing.output}}', ctx)).toBe('');
  });

  it('handles multiple placeholders in one string', () => {
    const result = interpolate('{{vars.myVar}} and {{env.MY_ENV}}', ctx);
    expect(result).toBe('varValue and envValue');
  });

  it('leaves non-placeholder text unchanged', () => {
    expect(interpolate('no placeholders here', ctx)).toBe('no placeholders here');
  });

  it('handles whitespace inside placeholder braces', () => {
    expect(interpolate('{{ input }}', ctx, 'trimmed')).toBe('trimmed');
  });
});

// ── interpolateDeep ───────────────────────────────────────────────────────────

describe('interpolateDeep', () => {
  let ctx: ExecutionContext;

  beforeEach(() => {
    ctx = createContext('deep prompt', { k: 'K' });
  });

  it('interpolates plain strings', () => {
    expect(interpolateDeep('hello {{input}}', ctx, 'world')).toBe('hello world');
  });

  it('interpolates nested object values', () => {
    const result = interpolateDeep({ a: '{{input}}', b: { c: '{{vars.k}}' } }, ctx, 'X');
    expect(result).toEqual({ a: 'X', b: { c: 'K' } });
  });

  it('interpolates array items', () => {
    const result = interpolateDeep(['{{input}}', '{{vars.k}}'], ctx, 'Y');
    expect(result).toEqual(['Y', 'K']);
  });

  it('passes non-string primitives through unchanged', () => {
    expect(interpolateDeep(42, ctx)).toBe(42);
    expect(interpolateDeep(true, ctx)).toBe(true);
    expect(interpolateDeep(null, ctx)).toBe(null);
  });
});
