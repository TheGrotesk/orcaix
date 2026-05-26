import { describe, it, expect } from 'vitest';
import {
  WorkflowSchema,
  LLMStageSchema,
  ShellStageSchema,
  FileStageSchema,
  HTTPStageSchema,
  InputStageSchema,
  LoopStageSchema,
  StageSchema,
} from '../src/types.js';

// ── LLMStageSchema ────────────────────────────────────────────────────────────

describe('LLMStageSchema', () => {
  const valid = {
    id: 'analyze',
    type: 'llm',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    prompt: 'Review this: {{input}}',
  };

  it('parses a minimal valid llm stage', () => {
    expect(LLMStageSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts optional fields', () => {
    const result = LLMStageSchema.safeParse({
      ...valid,
      system: 'You are an expert.',
      temperature: 0.7,
      max_tokens: 2000,
      files: ['src/**/*.ts'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown provider', () => {
    expect(LLMStageSchema.safeParse({ ...valid, provider: 'unknown' }).success).toBe(false);
  });

  it('rejects temperature out of range', () => {
    expect(LLMStageSchema.safeParse({ ...valid, temperature: 3 }).success).toBe(false);
    expect(LLMStageSchema.safeParse({ ...valid, temperature: -1 }).success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const { prompt: _p, ...noPrompt } = valid;
    expect(LLMStageSchema.safeParse(noPrompt).success).toBe(false);
  });
});

// ── ShellStageSchema ──────────────────────────────────────────────────────────

describe('ShellStageSchema', () => {
  const valid = { id: 'run', type: 'shell', command: 'npm test' };

  it('parses a minimal shell stage', () => {
    expect(ShellStageSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts interactive flag', () => {
    expect(ShellStageSchema.safeParse({ ...valid, interactive: true }).success).toBe(true);
  });

  it('accepts workdir', () => {
    expect(ShellStageSchema.safeParse({ ...valid, workdir: '/tmp' }).success).toBe(true);
  });

  it('rejects missing command', () => {
    expect(ShellStageSchema.safeParse({ id: 'run', type: 'shell' }).success).toBe(false);
  });
});

// ── FileStageSchema ───────────────────────────────────────────────────────────

describe('FileStageSchema', () => {
  it('parses a write stage', () => {
    const result = FileStageSchema.safeParse({
      id: 'save',
      type: 'file',
      action: 'write',
      path: './out.txt',
      content: 'hello',
    });
    expect(result.success).toBe(true);
  });

  it('parses a read stage without content', () => {
    const result = FileStageSchema.safeParse({ id: 'load', type: 'file', action: 'read', path: './in.txt' });
    expect(result.success).toBe(true);
  });

  it('rejects unknown action', () => {
    expect(FileStageSchema.safeParse({ id: 'x', type: 'file', action: 'delete', path: './x' }).success).toBe(false);
  });

  it('defaults encoding to utf-8', () => {
    const result = FileStageSchema.safeParse({ id: 'x', type: 'file', action: 'read', path: './x' });
    expect(result.success && result.data.encoding).toBe('utf-8');
  });
});

// ── HTTPStageSchema ───────────────────────────────────────────────────────────

describe('HTTPStageSchema', () => {
  const valid = { id: 'fetch', type: 'http', method: 'GET', url: 'https://example.com' };

  it('parses a minimal http stage', () => {
    expect(HTTPStageSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts all valid HTTP methods', () => {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
      expect(HTTPStageSchema.safeParse({ ...valid, method }).success).toBe(true);
    }
  });

  it('rejects invalid method', () => {
    expect(HTTPStageSchema.safeParse({ ...valid, method: 'CONNECT' }).success).toBe(false);
  });

  it('accepts body and headers', () => {
    const result = HTTPStageSchema.safeParse({
      ...valid,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { text: 'hello' },
    });
    expect(result.success).toBe(true);
  });
});

// ── InputStageSchema ──────────────────────────────────────────────────────────

describe('InputStageSchema', () => {
  it('parses a valid input stage', () => {
    const result = InputStageSchema.safeParse({
      id: 'approve',
      type: 'input',
      message: 'Proceed? (yes/no)',
    });
    expect(result.success).toBe(true);
  });

  it('accepts next conditions', () => {
    const result = InputStageSchema.safeParse({
      id: 'approve',
      type: 'input',
      message: 'Proceed?',
      next: [{ condition: "output === 'yes'", stage: 'next_stage' }],
    });
    expect(result.success).toBe(true);
  });
});

// ── LoopStageSchema ───────────────────────────────────────────────────────────

describe('LoopStageSchema', () => {
  const valid = {
    id: 'fix_loop',
    type: 'loop',
    until: "!output.includes('FAIL')",
    stages: [
      { id: 'run', type: 'shell', command: 'npm test' },
    ],
  };

  it('parses a minimal loop stage', () => {
    const result = LoopStageSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('defaults max_iterations to 10', () => {
    const result = LoopStageSchema.safeParse(valid);
    expect(result.success && result.data.max_iterations).toBe(10);
  });

  it('accepts nested llm stages', () => {
    const result = LoopStageSchema.safeParse({
      ...valid,
      stages: [
        {
          id: 'fix',
          type: 'llm',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          prompt: 'Fix: {{input}}',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing stages array', () => {
    const { stages: _s, ...noStages } = valid;
    expect(LoopStageSchema.safeParse(noStages).success).toBe(false);
  });
});

// ── StageSchema discriminated union ──────────────────────────────────────────

describe('StageSchema', () => {
  it('parses all stage types via the union', () => {
    const stages = [
      { id: 'a', type: 'llm', provider: 'openai', model: 'gpt-4o', prompt: 'hi' },
      { id: 'b', type: 'shell', command: 'echo hi' },
      { id: 'c', type: 'file', action: 'read', path: './x' },
      { id: 'd', type: 'http', method: 'GET', url: 'https://x.com' },
      { id: 'e', type: 'input', message: 'ok?' },
      { id: 'f', type: 'loop', until: 'false', stages: [{ id: 'g', type: 'shell', command: 'echo' }] },
    ];
    for (const s of stages) {
      expect(StageSchema.safeParse(s).success, `stage type ${s.type}`).toBe(true);
    }
  });

  it('rejects unknown stage type', () => {
    expect(StageSchema.safeParse({ id: 'x', type: 'unknown' }).success).toBe(false);
  });
});

// ── WorkflowSchema ────────────────────────────────────────────────────────────

describe('WorkflowSchema', () => {
  const minimal = {
    name: 'Test Workflow',
    stages: [{ id: 'step1', type: 'shell', command: 'echo hello' }],
  };

  it('parses a minimal valid workflow', () => {
    expect(WorkflowSchema.safeParse(minimal).success).toBe(true);
  });

  it('accepts optional fields', () => {
    const result = WorkflowSchema.safeParse({
      ...minimal,
      description: 'A test workflow',
      version: '1.0',
      import: ['./templates.yaml'],
      templates: { greeting: 'Hello!' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty stages array', () => {
    expect(WorkflowSchema.safeParse({ name: 'Empty', stages: [] }).success).toBe(false);
  });

  it('rejects missing name', () => {
    expect(WorkflowSchema.safeParse({ stages: minimal.stages }).success).toBe(false);
  });
});
