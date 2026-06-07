#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import { Command } from 'commander';
import chalk from 'chalk';
import * as dotenv from 'dotenv';
import { loadWorkflow, runWorkflow, resolveTemplates } from './runner.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const program = new Command();

program
  .name('orcaix')
  .description('Orcaix — run AI agent workflows from YAML files')
  .version(version);

// ── orcaix run ─────────────────────────────────────────────────────────────────

program
  .command('run <workflow>')
  .description('Execute a workflow YAML file')
  .option('-p, --prompt <text>', 'Initial prompt text')
  .option('--prompt-file <path>', 'Read initial prompt from a file')
  .option(
    '--var <key=value>',
    'Set extra context variables (repeatable)',
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .option('--dry-run', 'Print stages without executing any API calls')
  .option('--output <path>', 'Write final output to a file')
  .option('--env-file <path>', 'Load environment variables from a .env file (default: .env)')
  .option('--resume', 'Resume from checkpoint without prompting')
  .option('--fresh', 'Ignore any existing checkpoint and start from the beginning')
  .action(
    async (
      workflowArg: string,
      opts: {
        prompt?: string;
        promptFile?: string;
        var: string[];
        dryRun?: boolean;
        output?: string;
        envFile?: string;
        resume?: boolean;
        fresh?: boolean;
      },
    ) => {
      try {
        // Load .env file — explicit path, then fallback to .env in cwd
        const envPath = opts.envFile ? resolve(opts.envFile) : resolve('.env');
        if (opts.envFile && !existsSync(envPath)) {
          console.error(chalk.red(`Error: env file not found: ${envPath}`));
          process.exit(1);
        }
        const envResult = dotenv.config({ path: envPath });
        if (envResult.parsed && Object.keys(envResult.parsed).length > 0) {
          console.log(chalk.gray(`Loaded ${Object.keys(envResult.parsed).length} var(s) from ${envPath}`));
        }

        const workflowPath = resolve(workflowArg);

        // Resolve prompt — optional; LLM stages validate non-empty input at runtime
        let prompt: string;
        if (opts.promptFile) {
          prompt = readFileSync(resolve(opts.promptFile), 'utf-8').trim();
        } else {
          prompt = opts.prompt ?? '';
        }

        // Parse --var KEY=VALUE pairs
        const vars: Record<string, string> = {};
        for (const entry of opts.var) {
          const eqIdx = entry.indexOf('=');
          if (eqIdx === -1) {
            console.error(chalk.red(`Invalid --var format: "${entry}" (expected KEY=value)`));
            process.exit(1);
          }
          const key = entry.slice(0, eqIdx);
          const value = entry.slice(eqIdx + 1);
          vars[key] = value;
        }

        await runWorkflow(workflowPath, {
          prompt,
          vars,
          dryRun: opts.dryRun,
          outputPath: opts.output ? resolve(opts.output) : undefined,
          resume: opts.resume,
          fresh: opts.fresh,
        });
      } catch (err) {
        console.error(chalk.red('\nError:'), err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    },
  );

// ── orcaix validate ─────────────────────────────────────────────────────────────

program
  .command('validate <workflow>')
  .description('Validate a workflow YAML file without running it')
  .action((workflowArg: string) => {
    try {
      const workflowPath = resolve(workflowArg);
      const workflow = loadWorkflow(workflowPath);
      const templates = resolveTemplates(workflowPath, workflow);
      const importCount = Object.keys(templates).length - Object.keys(workflow.templates ?? {}).length;
      console.log(chalk.green(`✓ "${workflow.name}" is valid`));
      console.log(chalk.gray(`  ${workflow.stages.length} stage(s): ${workflow.stages.map((s) => s.id).join(', ')}`));
      if ((workflow.import ?? []).length > 0) {
        console.log(chalk.gray(`  imports: ${workflow.import!.join(', ')} (${importCount} template(s) loaded)`));
      }
    } catch (err) {
      console.error(chalk.red('Validation failed:'), err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ── orcaix init ─────────────────────────────────────────────────────────────────

program
  .command('init <name>')
  .description('Scaffold a new workflow YAML file')
  .action((name: string) => {
    const fileName = name.endsWith('.yaml') || name.endsWith('.yml') ? name : `${name}.yaml`;
    const template = `name: ${name}
description: Describe what this workflow does
version: "1.0"

# Reusable prompt snippets — reference anywhere as {{templates.name}}
templates:
  system_default: You are a helpful, expert assistant. Be concise and accurate.
  output_format: Output only the requested content — no preamble or explanation.

stages:
  - id: step1
    type: llm
    provider: anthropic
    model: claude-sonnet-4-6
    system: You are a helpful assistant.
    prompt: "{{input}}"
    temperature: 0.7
    max_tokens: 2048

  # Example shell stage
  # - id: run_cmd
  #   type: shell
  #   command: "echo '{{input}}'"

  # Example file write stage
  # - id: save
  #   type: file
  #   action: write
  #   path: ./output-{{timestamp}}.txt
  #   content: "{{stages.step1.output}}"

  # Example HTTP stage
  # - id: fetch
  #   type: http
  #   method: GET
  #   url: "https://api.example.com/data?q={{input}}"
  #   headers:
  #     Authorization: "Bearer {{env.MY_TOKEN}}"
`;

    writeFileSync(fileName, template, 'utf-8');
    console.log(chalk.green(`Created ${fileName}`));
    console.log(chalk.gray(`Run with: orcaix run ${fileName} --prompt "your input"`));
  });

// ── Parse ─────────────────────────────────────────────────────────────────────

program.parse(process.argv);
