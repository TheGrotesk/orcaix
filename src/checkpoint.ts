import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { resolve, join } from 'path';

const CHECKPOINT_DIR = '.orcaix-checkpoints';

export interface CheckpointData {
  workflowPath: string;
  workflowName: string;
  prompt: string;
  startedAt: string;
  updatedAt: string;
  stages: Record<string, { output: string }>;
  vars: Record<string, string>;
  nextIndex: number;
  currentInput: string;
}

export function checkpointKey(workflowPath: string, prompt: string): string {
  return createHash('md5').update(`${resolve(workflowPath)}:${prompt}`).digest('hex').slice(0, 16);
}

function checkpointPath(key: string): string {
  return join(resolve(CHECKPOINT_DIR), `${key}.json`);
}

export function loadCheckpoint(key: string): CheckpointData | null {
  const path = checkpointPath(key);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as CheckpointData;
  } catch {
    return null;
  }
}

export function saveCheckpoint(key: string, data: CheckpointData): void {
  mkdirSync(resolve(CHECKPOINT_DIR), { recursive: true });
  writeFileSync(checkpointPath(key), JSON.stringify(data, null, 2), 'utf-8');
}

export function clearCheckpoint(key: string): void {
  const path = checkpointPath(key);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}
