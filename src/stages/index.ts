import type { Stage } from '../types.js';
import type { ExecutionContext } from '../context.js';
import { executeLLMStage } from './llm.js';
import { executeShellStage } from './shell.js';
import { executeFileStage } from './file.js';
import { executeHTTPStage } from './http.js';
import { executeInputStage } from './input.js';
import { executeLoopStage } from './loop.js';
import { executeWorkflowStage } from './workflow.js';

/**
 * Dispatch a stage to the appropriate handler and return its output string.
 */
export async function executeStage(
  stage: Stage,
  ctx: ExecutionContext,
  currentInput: string,
): Promise<string> {
  switch (stage.type) {
    case 'llm':
      return executeLLMStage(stage, ctx, currentInput);
    case 'shell':
      return executeShellStage(stage, ctx, currentInput);
    case 'file':
      return executeFileStage(stage, ctx, currentInput);
    case 'http':
      return executeHTTPStage(stage, ctx, currentInput);
    case 'input':
      return executeInputStage(stage, ctx, currentInput);
    case 'loop':
      return executeLoopStage(stage, ctx, currentInput);
    case 'workflow':
      return executeWorkflowStage(stage, ctx, currentInput);
    default: {
      const exhaustive = stage as { type: string };
      throw new Error(`Unknown stage type: ${exhaustive.type}`);
    }
  }
}
