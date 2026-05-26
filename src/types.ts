import { z } from 'zod';

// ── Provider ────────────────────────────────────────────────────────────────

export const ProviderSchema = z.enum(['anthropic', 'openai', 'gemini']);
export type Provider = z.infer<typeof ProviderSchema>;

// ── Next / conditional routing ───────────────────────────────────────────────

export const NextConditionSchema = z.object({
  condition: z.string().optional(),
  stage: z.string(),
});
export type NextCondition = z.infer<typeof NextConditionSchema>;

// ── LLM stage ───────────────────────────────────────────────────────────────

export const LLMStageSchema = z.object({
  id: z.string(),
  type: z.literal('llm'),
  provider: ProviderSchema,
  model: z.string(),
  system: z.string().optional(),
  prompt: z.string(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  files: z.array(z.string()).optional(), // glob patterns loaded as context before the LLM call
  next: z.array(NextConditionSchema).optional(),
});
export type LLMStage = z.infer<typeof LLMStageSchema>;

// ── Shell stage ──────────────────────────────────────────────────────────────

export const ShellStageSchema = z.object({
  id: z.string(),
  type: z.literal('shell'),
  command: z.string(),
  workdir: z.string().optional(),
  interactive: z.boolean().optional(),
  next: z.array(NextConditionSchema).optional(),
});
export type ShellStage = z.infer<typeof ShellStageSchema>;

// ── File stage ───────────────────────────────────────────────────────────────

export const FileStageSchema = z.object({
  id: z.string(),
  type: z.literal('file'),
  action: z.enum(['read', 'write', 'append']),
  path: z.string(),
  content: z.string().optional(),
  encoding: z.string().optional().default('utf-8'),
  next: z.array(NextConditionSchema).optional(),
});
export type FileStage = z.infer<typeof FileStageSchema>;

// ── HTTP stage ───────────────────────────────────────────────────────────────

export const HTTPStageSchema = z.object({
  id: z.string(),
  type: z.literal('http'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
  url: z.string(),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
  next: z.array(NextConditionSchema).optional(),
});
export type HTTPStage = z.infer<typeof HTTPStageSchema>;

// ── Input stage ───────────────────────────────────────────────────────────────

export const InputStageSchema = z.object({
  id: z.string(),
  type: z.literal('input'),
  message: z.string(),
  placeholder: z.string().optional(),
  next: z.array(NextConditionSchema).optional(),
});
export type InputStage = z.infer<typeof InputStageSchema>;

// ── Workflow stage ────────────────────────────────────────────────────────────

export const WorkflowStageSchema = z.object({
  id: z.string(),
  type: z.literal('workflow'),
  path: z.string(),                          // path to sub-workflow YAML (relative to parent workflow dir)
  prompt: z.string().optional(),             // input passed to sub-workflow; defaults to current input
  vars: z.record(z.string()).optional(),     // extra vars merged into sub-workflow context
  next: z.array(NextConditionSchema).optional(),
});
export type WorkflowStage = z.infer<typeof WorkflowStageSchema>;

// ── Loop stage ───────────────────────────────────────────────────────────────
// Recursive schema: loop.stages can contain any Stage, including nested loops.
// TypeScript can't infer recursive types from z.infer — we define LoopStage manually
// and annotate both schemas explicitly to break the circular reference.

export type LoopStage = {
  id: string;
  type: 'loop';
  stages: Stage[];
  until: string;
  max_iterations: number;
  approve?: boolean;
  approve_message?: string;
  next?: NextCondition[];
};

// ── Union stage type ─────────────────────────────────────────────────────────
// Stage must be declared before LoopStageSchema so the manual type can reference it.

export type Stage =
  | LLMStage
  | ShellStage
  | FileStage
  | HTTPStage
  | InputStage
  | LoopStage
  | WorkflowStage;

// StageSchema is assigned after LoopStageSchema — use a let so z.lazy can close over it.
// The explicit annotation prevents the "implicitly any" circular inference error.
export let StageSchema: z.ZodType<Stage>; // eslint-disable-line prefer-const

export const LoopStageSchema: z.ZodType<LoopStage> = z.object({
  id: z.string(),
  type: z.literal('loop'),
  stages: z.lazy(() => z.array(StageSchema)),
  until: z.string(),
  max_iterations: z.number().int().positive().default(10),
  approve: z.boolean().optional(),
  approve_message: z.string().optional(),
  next: z.array(NextConditionSchema).optional(),
}) as z.ZodType<LoopStage>;

// Assign the union — cast LoopStageSchema back to ZodObject shape expected by discriminatedUnion.
StageSchema = z.discriminatedUnion('type', [
  LLMStageSchema,
  ShellStageSchema,
  FileStageSchema,
  HTTPStageSchema,
  InputStageSchema,
  LoopStageSchema as unknown as z.ZodObject<{ type: z.ZodLiteral<'loop'> }>,
  WorkflowStageSchema,
]) as z.ZodType<Stage>;

// ── Template file (standalone .yaml with only a templates block) ─────────────

export const TemplateFileSchema = z.object({
  templates: z.record(z.string()),
});
export type TemplateFile = z.infer<typeof TemplateFileSchema>;

// ── Workflow ─────────────────────────────────────────────────────────────────

export const WorkflowSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  version: z.string().optional(),
  import: z.array(z.string()).optional(),     // paths to template files (resolved relative to workflow)
  templates: z.record(z.string()).optional(), // inline templates; override imported ones on conflict
  stages: z.array(StageSchema).min(1, 'Workflow must have at least one stage'),
});
export type Workflow = z.infer<typeof WorkflowSchema>;
