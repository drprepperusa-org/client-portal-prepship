import { z } from 'zod';

export const workflowRunStatuses = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export const workflowStepStatuses = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'blocked',
  'cancelled',
] as const;

export const workflowRetrySchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(5).default(1),
    backoffMs: z.number().int().min(0).max(60_000).default(0),
  })
  .default({ maxAttempts: 1, backoffMs: 0 });

export const workflowStepSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9_-]+$/),
  action: z.string().min(1).max(120),
  dependsOn: z.array(z.string().min(1)).default([]),
  parallelGroup: z.string().min(1).max(80).nullable().optional(),
  input: z.record(z.unknown()).default({}),
  retry: workflowRetrySchema,
  timeoutMs: z.number().int().min(100).max(120_000).default(30_000),
  idempotencyKey: z.string().min(1).max(240).nullable().optional(),
});

export const workflowSpecSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9 _.-]+$/),
  description: z.string().max(500).nullable().optional(),
  version: z.number().int().positive().default(1),
  steps: z.array(workflowStepSchema).min(1).max(50),
});

export const workflowPlannerRequestSchema = z.object({
  request: z.string().min(10).max(4_000),
  context: z.record(z.unknown()).default({}),
});

export const workflowPlannerResponseSchema = z.object({
  spec: workflowSpecSchema,
  warnings: z.array(z.string()).default([]),
});

export type WorkflowSpec = z.infer<typeof workflowSpecSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type WorkflowRunStatus = (typeof workflowRunStatuses)[number];
export type WorkflowStepStatus = (typeof workflowStepStatuses)[number];
export type WorkflowPlannerRequest = z.infer<typeof workflowPlannerRequestSchema>;
export type WorkflowPlannerResponse = z.infer<typeof workflowPlannerResponseSchema>;

export type WorkflowExecutionContext = {
  runId: number;
  workflowId: number;
  input: Record<string, unknown>;
  stepOutputs: Record<string, Record<string, unknown>>;
};

export type WorkflowActionDefinition = {
  name: string;
  description: string;
  mutatesData: boolean;
  requiredPermission: 'settings:read' | 'settings:write' | 'credentials:read' | 'credentials:write';
  inputSchema: z.ZodType<Record<string, unknown>>;
  outputSchema: z.ZodType<Record<string, unknown>>;
  execute: (
    input: Record<string, unknown>,
    context: WorkflowExecutionContext,
  ) => Promise<Record<string, unknown>>;
};

export type WorkflowExecutionResult = {
  runId: number;
  status: WorkflowRunStatus;
  output: Record<string, unknown>;
  error?: string;
};
