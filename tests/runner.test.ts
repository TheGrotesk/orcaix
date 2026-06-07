import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { resolve, join } from 'path';
import { loadWorkflow, resolveTemplates } from '../src/runner.js';

// Use a temp directory for workflow fixture files
const TMP = resolve('/tmp/orcaix-runner-tests');

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

function writeTmp(name: string, content: string): string {
  const p = join(TMP, name);
  writeFileSync(p, content, 'utf-8');
  return p;
}

// ── loadWorkflow ──────────────────────────────────────────────────────────────

describe('loadWorkflow', () => {
  it('parses a minimal valid workflow', () => {
    const p = writeTmp('wf.yaml', `
name: My Workflow
stages:
  - id: step1
    type: shell
    command: echo hello
`);
    const wf = loadWorkflow(p);
    expect(wf.name).toBe('My Workflow');
    expect(wf.stages).toHaveLength(1);
    expect(wf.stages[0].id).toBe('step1');
  });

  it('throws for a non-existent file', () => {
    expect(() => loadWorkflow(join(TMP, 'ghost.yaml'))).toThrow(/Failed to read/);
  });

  it('throws for invalid YAML schema', () => {
    const p = writeTmp('bad.yaml', `
name: Bad
stages: []
`);
    expect(() => loadWorkflow(p)).toThrow(/Invalid workflow YAML/);
  });

  it('parses workflows with all common optional fields', () => {
    const p = writeTmp('full.yaml', `
name: Full Workflow
description: A complete workflow
version: "1.0"
templates:
  greeting: Hello!
stages:
  - id: step1
    type: llm
    provider: anthropic
    model: claude-sonnet-4-6
    prompt: "{{input}}"
    max_tokens: 1000
`);
    const wf = loadWorkflow(p);
    expect(wf.description).toBe('A complete workflow');
    expect(wf.templates?.greeting).toBe('Hello!');
    expect(wf.stages[0].type).toBe('llm');
  });

  it('parses a workflow with next conditions', () => {
    const p = writeTmp('branching.yaml', `
name: Branching
stages:
  - id: classify
    type: shell
    command: echo critical
    next:
      - condition: "output.includes('critical')"
        stage: escalate
      - stage: close
  - id: escalate
    type: shell
    command: echo escalating
  - id: close
    type: shell
    command: echo closing
`);
    const wf = loadWorkflow(p);
    const classify = wf.stages[0];
    expect(classify.next).toHaveLength(2);
    expect(classify.next![0].condition).toBe("output.includes('critical')");
    expect(classify.next![1].stage).toBe('close');
  });
});

// ── resolveTemplates ──────────────────────────────────────────────────────────

describe('resolveTemplates', () => {
  it('returns empty object when no imports or inline templates', () => {
    const p = writeTmp('wf.yaml', `
name: Simple
stages:
  - id: s1
    type: shell
    command: echo
`);
    const wf = loadWorkflow(p);
    const templates = resolveTemplates(p, wf);
    expect(templates).toEqual({});
  });

  it('returns inline templates from the workflow', () => {
    const p = writeTmp('wf.yaml', `
name: With Templates
templates:
  persona: You are an expert.
stages:
  - id: s1
    type: shell
    command: echo
`);
    const wf = loadWorkflow(p);
    const templates = resolveTemplates(p, wf);
    expect(templates.persona).toBe('You are an expert.');
  });

  it('loads templates from imported files', () => {
    writeTmp('personas.yaml', `
templates:
  engineer: You are a senior software engineer.
  sre: You are a Site Reliability Engineer.
`);
    const p = writeTmp('wf.yaml', `
name: With Imports
import:
  - ./personas.yaml
stages:
  - id: s1
    type: shell
    command: echo
`);
    const wf = loadWorkflow(p);
    const templates = resolveTemplates(p, wf);
    expect(templates.engineer).toBe('You are a senior software engineer.');
    expect(templates.sre).toBe('You are a Site Reliability Engineer.');
  });

  it('inline templates override imported ones on key conflict', () => {
    writeTmp('base.yaml', `
templates:
  persona: Base persona.
  format: Base format.
`);
    const p = writeTmp('wf.yaml', `
name: Override Test
import:
  - ./base.yaml
templates:
  persona: Overridden persona.
stages:
  - id: s1
    type: shell
    command: echo
`);
    const wf = loadWorkflow(p);
    const templates = resolveTemplates(p, wf);
    expect(templates.persona).toBe('Overridden persona.');
    expect(templates.format).toBe('Base format.');
  });

  it('later imports override earlier ones on key conflict', () => {
    writeTmp('first.yaml', `templates:\n  key: first`);
    writeTmp('second.yaml', `templates:\n  key: second`);
    const p = writeTmp('wf.yaml', `
name: Import Order
import:
  - ./first.yaml
  - ./second.yaml
stages:
  - id: s1
    type: shell
    command: echo
`);
    const wf = loadWorkflow(p);
    const templates = resolveTemplates(p, wf);
    expect(templates.key).toBe('second');
  });

  it('throws for a missing import file', () => {
    const p = writeTmp('wf.yaml', `
name: Bad Import
import:
  - ./nonexistent.yaml
stages:
  - id: s1
    type: shell
    command: echo
`);
    const wf = loadWorkflow(p);
    expect(() => resolveTemplates(p, wf)).toThrow(/Failed to load template file/);
  });
});
