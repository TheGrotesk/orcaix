import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { load as yamlLoad } from 'js-yaml';
import chalk from 'chalk';
import { WorkflowSchema, TemplateFileSchema } from './types.js';
import type { Workflow, Stage, NextCondition, LLMStage } from './types.js';
import { createContext } from './context.js';
import type { ExecutionContext } from './context.js';
import { executeStage } from './stages/index.js';
import { PROVIDER_ENV_KEYS } from './providers/index.js';
import type { Provider } from './types.js';
import { checkpointKey, loadCheckpoint, saveCheckpoint, clearCheckpoint } from './checkpoint.js';
import { readLine } from './stdin.js';

export interface RunOptions {
  prompt: string;
  vars?: Record<string, string>;
  dryRun?: boolean;
  outputPath?: string;
  resume?: boolean;
  fresh?: boolean;
}

// ── YAML loading & validation ─────────────────────────────────────────────────

export function loadWorkflow(filePath: string): Workflow {
  let raw: unknown;
  try {
    const content = readFileSync(filePath, 'utf-8');
    raw = yamlLoad(content);
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Failed to read workflow file "${filePath}": ${err.message}`);
    }
    throw err;
  }

  const result = WorkflowSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid workflow YAML:\n${issues}`);
  }
  return result.data;
}

// ── Template import resolution ───────────────────────────────────────────────

export function resolveTemplates(workflowFilePath: string, workflow: Workflow): Record<string, string> {
  const merged: Record<string, string> = {};
  const workflowDir = dirname(resolve(workflowFilePath));

  for (const importPath of workflow.import ?? []) {
    const absolutePath = resolve(workflowDir, importPath);
    let raw: unknown;
    try {
      raw = yamlLoad(readFileSync(absolutePath, 'utf-8'));
    } catch (err) {
      throw new Error(
        `Failed to load template file "${importPath}" (resolved to "${absolutePath}"): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const result = TemplateFileSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Invalid template file "${importPath}":\n${issues}`);
    }

    // Later imports override earlier ones on key conflict
    Object.assign(merged, result.data.templates);
  }

  // Workflow-level templates override all imports
  Object.assign(merged, workflow.templates ?? {});
  return merged;
}

// ── Provider key pre-flight ───────────────────────────────────────────────────

function collectRequiredProviders(workflow: Workflow): Set<Provider> {
  const providers = new Set<Provider>();
  function walk(stages: Stage[]) {
    for (const stage of stages) {
      if (stage.type === 'llm') providers.add(stage.provider);
      if (stage.type === 'loop') walk(stage.stages as Stage[]);
    }
  }
  walk(workflow.stages);
  return providers;
}

function checkRequiredKeys(workflow: Workflow): void {
  const providers = collectRequiredProviders(workflow);
  const missing: string[] = [];
  for (const provider of providers) {
    const key = PROVIDER_ENV_KEYS[provider];
    if (!process.env[key]) {
      missing.push(`${key} (needed for provider "${provider}")`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required API keys:\n${missing.map((m) => `  • ${m}`).join('\n')}\n\nSet them as environment variables before running.`,
    );
  }
}

// ── Conditional routing ───────────────────────────────────────────────────────

function evaluateNextConditions(
  conditions: NextCondition[],
  output: string,
): string | null {
  for (const cond of conditions) {
    if (!cond.condition) {
      // Default (condition-less) entry
      return cond.stage;
    }
    try {
      // Evaluate JS expression with `output` in scope
      // eslint-disable-next-line no-new-func
      const fn = new Function('output', `return (${cond.condition});`);
      const result = fn(output) as boolean;
      if (result) {
        return cond.stage;
      }
    } catch (err) {
      throw new Error(
        `Error evaluating next condition "${cond.condition}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return null;
}

// ── Dry run ───────────────────────────────────────────────────────────────────

function printDryRun(workflow: Workflow): void {
  console.log(chalk.bold.cyan(`\nDry run: ${workflow.name}`));
  if (workflow.description) {
    console.log(chalk.gray(workflow.description));
  }
  console.log();

  const total = workflow.stages.length;
  for (let i = 0; i < total; i++) {
    const stage = workflow.stages[i];
    const idx = chalk.bold.white(`[${i + 1}/${total}]`);
    const id = chalk.yellow(stage.id);
    const type = chalk.cyan(stage.type);

    let extra = '';
    if (stage.type === 'llm') {
      extra = chalk.gray(` · ${stage.provider}/${stage.model}`);
    }

    console.log(`${idx} ${id} (${type}${extra})`);

    if (stage.type === 'llm') {
      console.log(
        chalk.gray('  prompt: ') +
          chalk.white(stage.prompt.replace(/\{\{input\}\}/g, '[input]').slice(0, 120)),
      );
    } else if (stage.type === 'shell') {
      console.log(
        chalk.gray('  command: ') +
          chalk.white(stage.command.replace(/\{\{input\}\}/g, '[input]')),
      );
    } else if (stage.type === 'file') {
      console.log(
        chalk.gray(`  action: ${stage.action}  path: `) +
          chalk.white(stage.path.replace(/\{\{input\}\}/g, '[input]')),
      );
    } else if (stage.type === 'http') {
      console.log(chalk.gray(`  ${stage.method} `) + chalk.white(stage.url));
    } else if (stage.type === 'input') {
      console.log(chalk.gray('  message: ') + chalk.white(stage.message.split('\n')[0].slice(0, 80) + '…'));
    } else if (stage.type === 'loop') {
      const approval = stage.approve ? chalk.yellow(' · approve each iteration') : '';
      console.log(chalk.gray(`  until: `) + chalk.white(stage.until) + approval);
      console.log(chalk.gray(`  max_iterations: ${stage.max_iterations ?? 10}  sub-stages: ${(stage.stages as Stage[]).length}`));
      for (const sub of stage.stages as Stage[]) {
        const subType = chalk.cyan(sub.type);
        const subExtra = sub.type === 'llm' ? chalk.gray(` · ${sub.provider}/${sub.model}`) : '';
        console.log(chalk.gray(`    └ `) + chalk.yellow(sub.id) + ` (${subType}${subExtra})`);
      }
    } else if (stage.type === 'workflow') {
      console.log(chalk.gray('  path: ') + chalk.white(stage.path));
    }
    console.log();
  }
}

// ── Stage label helper ────────────────────────────────────────────────────────

function stageLabel(stage: Stage, index: number, total: number): string {
  const idx = chalk.bold.white(`[${index + 1}/${total}]`);
  const id = chalk.yellow(stage.id);
  const type = chalk.cyan(stage.type);

  if (stage.type === 'llm') {
    const llm = stage as LLMStage;
    return `${idx} ${id} (${type} · ${chalk.magenta(`${llm.provider}/${llm.model}`)})`;
  }
  if (stage.type === 'loop') {
    const maxIter = stage.max_iterations ?? 10;
    const approval = stage.approve ? chalk.yellow(' · approve') : '';
    return `${idx} ${id} (${type} · max ${maxIter}${approval})`;
  }
  return `${idx} ${id} (${type})`;
}

// ── Main run ──────────────────────────────────────────────────────────────────

export async function runWorkflow(workflowPath: string, options: RunOptions): Promise<string> {
  const workflow = loadWorkflow(workflowPath);

  if (options.dryRun) {
    printDryRun(workflow);
    return '';
  }

  checkRequiredKeys(workflow);

  const templates = resolveTemplates(workflowPath, workflow);
  const ctx: ExecutionContext = createContext(
    options.prompt,
    options.vars ?? {},
    templates,
    dirname(resolve(workflowPath)),
    options.dryRun,
  );

  console.log(chalk.bold.cyan(`\nRunning: ${workflow.name}`));
  if (workflow.description) {
    console.log(chalk.gray(workflow.description));
  }
  console.log();

  // Build a stage-id → index map for branching lookups
  const stageIndexById = new Map<string, number>(
    workflow.stages.map((s, i) => [s.id, i]),
  );

  const total = workflow.stages.length;
  let currentIndex = 0;
  let currentInput = options.prompt;
  let lastOutput = options.prompt;

  // ── Checkpoint resume ──────────────────────────────────────────────────────
  const ckKey = checkpointKey(workflowPath, options.prompt);
  let checkpoint = options.fresh ? null : loadCheckpoint(ckKey);

  if (checkpoint) {
    if (options.resume) {
      console.log(chalk.bold.yellow(`\nResuming from checkpoint (started ${checkpoint.startedAt})`));
      console.log(chalk.gray(`  Completed stages: ${Object.keys(checkpoint.stages).join(', ')}`));
      console.log();
    } else {
      console.log(
        chalk.bold.yellow('\nCheckpoint found') +
        chalk.gray(` — started ${checkpoint.startedAt}, last updated ${checkpoint.updatedAt}`),
      );
      console.log(chalk.gray(`  Completed stages: ${Object.keys(checkpoint.stages).join(', ')}`));
      process.stdout.write(chalk.cyan('\nResume from checkpoint? ') + chalk.gray('(yes / no — "no" starts fresh) '));

      if (!process.stdin.isTTY) {
        console.log(chalk.yellow('\nNon-interactive stdin — starting fresh.'));
        checkpoint = null;
      } else {
        const answer = await readLine();
        if (!['yes', 'y'].includes(answer.toLowerCase().trim())) {
          checkpoint = null;
          console.log(chalk.gray('Starting fresh.\n'));
        } else {
          console.log();
        }
      }
    }

    if (checkpoint) {
      // Restore completed stage outputs and vars into context
      Object.assign(ctx.stages, checkpoint.stages);
      Object.assign(ctx.vars, checkpoint.vars);
      currentIndex = checkpoint.nextIndex;
      currentInput = checkpoint.currentInput;
      lastOutput = checkpoint.currentInput;
    }
  }

  const ckBase = {
    workflowPath: resolve(workflowPath),
    workflowName: workflow.name,
    prompt: options.prompt,
    startedAt: checkpoint?.startedAt ?? new Date().toISOString(),
  };

  while (currentIndex < total) {
    const stage = workflow.stages[currentIndex];
    console.log(stageLabel(stage, currentIndex, total));

    const output = await executeStage(stage, ctx, currentInput);

    ctx.stages[stage.id] = { output };
    lastOutput = output;

    // Determine next index (evaluate branching before saving checkpoint)
    let nextIndex = currentIndex + 1;
    if (stage.next && stage.next.length > 0) {
      const nextStageId = evaluateNextConditions(stage.next, output);
      if (nextStageId !== null) {
        const ni = stageIndexById.get(nextStageId);
        if (ni === undefined) {
          throw new Error(
            `Conditional routing in stage "${stage.id}" references unknown stage id "${nextStageId}".`,
          );
        }
        nextIndex = ni;
      }
      // No conditions matched and no default — advance linearly
    }

    currentInput = output;
    currentIndex = nextIndex;

    // Save checkpoint after every completed stage
    saveCheckpoint(ckKey, {
      ...ckBase,
      updatedAt: new Date().toISOString(),
      stages: { ...ctx.stages },
      vars: { ...ctx.vars },
      nextIndex: currentIndex,
      currentInput,
    });
  }

  clearCheckpoint(ckKey);

  // Print final output
  console.log('\n' + chalk.bold('─'.repeat(60)));
  console.log(chalk.bold.green('Final output:'));
  console.log(chalk.white(lastOutput));
  console.log(chalk.bold('─'.repeat(60)));

  // Optionally write to file
  if (options.outputPath) {
    const { writeFile, mkdir } = await import('fs/promises');
    const { dirname } = await import('path');
    await mkdir(dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, lastOutput, 'utf-8');
    console.log(chalk.gray(`\nOutput written to: ${options.outputPath}`));
  }

  return lastOutput;
}
