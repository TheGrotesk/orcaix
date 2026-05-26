import { readFile } from 'fs/promises';
import { glob } from 'glob';
import chalk from 'chalk';
import type { LLMStage } from '../types.js';
import type { ExecutionContext } from '../context.js';
import { interpolate } from '../context.js';
import { getProvider } from '../providers/index.js';

const WARN_BYTES = 100_000;
const MAX_BYTES = 500_000;

export async function executeLLMStage(
  stage: LLMStage,
  ctx: ExecutionContext,
  currentInput: string,
): Promise<string> {
  let prompt = interpolate(stage.prompt, ctx, currentInput);
  const system = stage.system ? interpolate(stage.system, ctx, currentInput) : undefined;

  if (!prompt.trim()) {
    throw new Error(
      `Stage "${stage.id}" (llm): prompt resolved to an empty string. ` +
      'Pass --prompt, --prompt-file, or ensure a previous stage produces output.',
    );
  }

  if (stage.files && stage.files.length > 0) {
    const blocks: string[] = [];
    let totalBytes = 0;

    for (const pattern of stage.files) {
      const resolvedPattern = interpolate(pattern, ctx, currentInput);
      const matches = await glob(resolvedPattern, { nodir: true });
      for (const filePath of matches.sort()) {
        const content = await readFile(filePath, 'utf-8');
        totalBytes += Buffer.byteLength(content);
        if (totalBytes > MAX_BYTES) {
          throw new Error(
            `Stage "${stage.id}": files context exceeds 500 KB limit (${Math.round(totalBytes / 1000)} KB loaded). ` +
            'Narrow your glob patterns.',
          );
        }
        blocks.push(`<file path="${filePath}">\n${content}\n</file>`);
      }
    }

    if (totalBytes > WARN_BYTES) {
      process.stderr.write(
        chalk.yellow(`[warn] stage "${stage.id}": loading ${Math.round(totalBytes / 1000)} KB of file context\n`),
      );
    }

    if (blocks.length > 0) {
      prompt = blocks.join('\n\n') + '\n\n' + prompt;
    }
  }

  const provider = await getProvider(stage.provider);

  return provider.call(stage.model, system, prompt, {
    temperature: stage.temperature,
    max_tokens: stage.max_tokens,
  });
}
