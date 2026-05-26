import { resolve } from 'path';
import chalk from 'chalk';
import type { WorkflowStage } from '../types.js';
import type { ExecutionContext } from '../context.js';
import { interpolate } from '../context.js';
import { runWorkflow } from '../runner.js';

/** Workflow paths already executing — used to detect circular references. */
const _activeWorkflows = new Set<string>();

export async function executeWorkflowStage(
  stage: WorkflowStage,
  ctx: ExecutionContext,
  currentInput: string,
): Promise<string> {
  // Resolve path relative to the parent workflow's directory
  const subPath = resolve(ctx.workflowDir, interpolate(stage.path, ctx, currentInput));

  // Circular reference guard
  if (_activeWorkflows.has(subPath)) {
    throw new Error(
      `Circular workflow reference detected: "${subPath}" is already executing in the current call stack.`,
    );
  }

  // Merge parent vars with stage-level vars (stage vars take precedence)
  const vars: Record<string, string> = { ...ctx.vars };
  if (stage.vars) {
    for (const [k, v] of Object.entries(stage.vars)) {
      vars[k] = interpolate(v, ctx, currentInput);
    }
  }

  // Resolve the prompt passed to the sub-workflow
  const prompt = stage.prompt
    ? interpolate(stage.prompt, ctx, currentInput)
    : currentInput;

  console.log(chalk.gray(`  → running sub-workflow: ${stage.path}\n`));

  _activeWorkflows.add(subPath);
  try {
    const output = await runWorkflow(subPath, {
      prompt,
      vars,
      dryRun: ctx.dryRun,
      fresh: true,   // never prompt for checkpoint resume mid-workflow
    });
    return output;
  } finally {
    _activeWorkflows.delete(subPath);
  }
}
