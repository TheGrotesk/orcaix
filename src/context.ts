export interface StageResult {
  output: string;
  exitCode?: number;
}

export interface ExecutionContext {
  input: string;
  stages: Record<string, StageResult>;
  env: Record<string, string>;
  timestamp: string;
  vars: Record<string, string>;
  templates: Record<string, string>;
  /** Absolute directory of the workflow file — used to resolve sub-workflow paths. */
  workflowDir: string;
  /** When true, sub-workflows should also dry-run. */
  dryRun?: boolean;
}

/**
 * Create a fresh execution context for a workflow run.
 */
export function createContext(
  prompt: string,
  vars: Record<string, string> = {},
  templates: Record<string, string> = {},
  workflowDir: string = process.cwd(),
  dryRun?: boolean,
): ExecutionContext {
  return {
    input: prompt,
    stages: {},
    env: Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][],
    ),
    timestamp: new Date().toISOString().replace(/[:.]/g, '-'),
    vars,
    templates,
    workflowDir,
    dryRun,
  };
}

/**
 * Resolve a dot-separated path against an object.
 * e.g. resolvePathInObject(ctx, 'stages.analyze.output')
 */
function resolvePathInObject(obj: unknown, path: string): string {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return '';
    if (typeof current !== 'object') return String(current);
    current = (current as Record<string, unknown>)[part];
  }
  if (current === null || current === undefined) return '';
  return String(current);
}

/**
 * Interpolate all {{variable.path}} placeholders in a string using the
 * execution context. Supports:
 *   {{input}}                 — current input passed to this interpolation call
 *   {{stages.id.output}}      — output of a previous stage
 *   {{env.VAR}}               — environment variable
 *   {{timestamp}}             — run timestamp
 *   {{vars.KEY}}              — extra --var KEY=value variables
 */
export function interpolate(
  template: string,
  ctx: ExecutionContext,
  currentInput?: string,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, rawPath: string) => {
    const path = rawPath.trim();

    if (path === 'input') {
      return currentInput ?? ctx.input;
    }

    if (path === 'timestamp') {
      return ctx.timestamp;
    }

    if (path.startsWith('env.')) {
      const key = path.slice(4);
      return ctx.env[key] ?? '';
    }

    if (path.startsWith('vars.')) {
      const key = path.slice(5);
      return ctx.vars[key] ?? '';
    }

    if (path.startsWith('templates.')) {
      const key = path.slice(10);
      return ctx.templates[key] ?? '';
    }

    if (path.startsWith('stages.')) {
      return resolvePathInObject(ctx, path);
    }

    // Fallback: try resolving against the whole context object
    return resolvePathInObject(ctx, path);
  });
}

/**
 * Recursively interpolate all string values in an arbitrary object/array.
 * Used for HTTP body interpolation.
 */
export function interpolateDeep(
  value: unknown,
  ctx: ExecutionContext,
  currentInput?: string,
): unknown {
  if (typeof value === 'string') {
    return interpolate(value, ctx, currentInput);
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateDeep(item, ctx, currentInput));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        interpolateDeep(v, ctx, currentInput),
      ]),
    );
  }
  return value;
}
