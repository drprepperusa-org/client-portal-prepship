import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { workflowRuns, workflowStepRuns, workflowVersions } from '../../db/schema/workflows';
import { getWorkflowAction } from './action-registry';
import { interpolateWorkflowValue } from './interpolate';
import { recordWorkflowAudit } from './audit';
import { validateWorkflowSpec } from './validation';
import type { WorkflowExecutionResult, WorkflowSpec, WorkflowStep } from './types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getReadySteps(
  spec: WorkflowSpec,
  completed: Set<string>,
  failed: Set<string>,
  attempted: Set<string>,
): WorkflowStep[] {
  return spec.steps.filter((step) => {
    if (attempted.has(step.id) || failed.has(step.id)) return false;
    return step.dependsOn.every((dependency) => completed.has(dependency));
  });
}

async function runStep(input: {
  runId: number;
  workflowId: number;
  step: WorkflowStep;
  workflowInput: Record<string, unknown>;
  stepOutputs: Record<string, Record<string, unknown>>;
}): Promise<{ stepId: string; ok: true; output: Record<string, unknown> } | { stepId: string; ok: false; error: string }> {
  const action = getWorkflowAction(input.step.action);
  if (!action) return { stepId: input.step.id, ok: false, error: `Unknown action ${input.step.action}` };

  const interpolated = interpolateWorkflowValue(input.step.input, {
    input: input.workflowInput,
    stepOutputs: input.stepOutputs,
  });
  const actionInput = toRecord(interpolated);
  const parsedInput = action.inputSchema.safeParse(actionInput);
  if (!parsedInput.success) {
    return {
      stepId: input.step.id,
      ok: false,
      error: parsedInput.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    };
  }

  let lastError = 'Unknown workflow step error';
  const maxAttempts = Math.max(1, input.step.retry.maxAttempts);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const [stepRun] = await db
      .update(workflowStepRuns)
      .set({
        status: 'running',
        attempt,
        input: parsedInput.data,
        error: null,
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workflowStepRuns.workflowRunId, input.runId),
          eq(workflowStepRuns.stepId, input.step.id),
        ),
      )
      .returning();

    try {
      const rawOutput = await withTimeout(
        action.execute(parsedInput.data, {
          runId: input.runId,
          workflowId: input.workflowId,
          input: input.workflowInput,
          stepOutputs: input.stepOutputs,
        }),
        input.step.timeoutMs,
        input.step.id,
      );
      const parsedOutput = action.outputSchema.parse(rawOutput);
      await db
        .update(workflowStepRuns)
        .set({
          status: 'succeeded',
          output: parsedOutput,
          error: null,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workflowStepRuns.workflowRunId, input.runId),
            eq(workflowStepRuns.stepId, input.step.id),
          ),
        );
      await recordWorkflowAudit({
        workflowId: input.workflowId,
        workflowRunId: input.runId,
        workflowStepRunId: stepRun?.id,
        eventType: 'workflow_step.succeeded',
        detail: { stepId: input.step.id, action: input.step.action, attempt },
      });
      return { stepId: input.step.id, ok: true, output: parsedOutput };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await recordWorkflowAudit({
        workflowId: input.workflowId,
        workflowRunId: input.runId,
        workflowStepRunId: stepRun?.id,
        eventType: 'workflow_step.failed_attempt',
        detail: { stepId: input.step.id, action: input.step.action, attempt, error: lastError },
      });
      if (attempt < maxAttempts && input.step.retry.backoffMs > 0) await sleep(input.step.retry.backoffMs);
    }
  }

  await db
    .update(workflowStepRuns)
    .set({
      status: 'failed',
      error: lastError,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workflowStepRuns.workflowRunId, input.runId),
        eq(workflowStepRuns.stepId, input.step.id),
      ),
    );
  return { stepId: input.step.id, ok: false, error: lastError };
}

export async function executeWorkflowRun(runId: number): Promise<WorkflowExecutionResult> {
  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
  if (!run) throw new Error(`Workflow run not found: ${runId}`);
  if (run.status === 'cancelled') {
    return { runId, status: 'cancelled', output: toRecord(run.output), error: run.error ?? undefined };
  }

  const [version] = await db
    .select()
    .from(workflowVersions)
    .where(eq(workflowVersions.id, run.workflowVersionId))
    .limit(1);
  if (!version) throw new Error(`Workflow version not found: ${run.workflowVersionId}`);

  const validation = validateWorkflowSpec(version.spec);
  if (!validation.ok || !validation.spec) {
    throw new Error(`Workflow validation failed: ${validation.errors.join('; ')}`);
  }

  const spec = validation.spec;
  const workflowInput = toRecord(run.input);
  const stepOutputs: Record<string, Record<string, unknown>> = {};
  const completed = new Set<string>();
  const failed = new Set<string>();
  const attempted = new Set<string>();

  await db
    .update(workflowRuns)
    .set({ status: 'running', startedAt: new Date(), updatedAt: new Date(), error: null })
    .where(eq(workflowRuns.id, runId));

  while (completed.size + failed.size < spec.steps.length) {
    const ready = getReadySteps(spec, completed, failed, attempted);
    if (ready.length === 0) break;
    ready.forEach((step) => attempted.add(step.id));

    const results = await Promise.all(
      ready.map((step) =>
        runStep({
          runId,
          workflowId: run.workflowId,
          step,
          workflowInput,
          stepOutputs,
        }),
      ),
    );

    for (const result of results) {
      if (result.ok) {
        completed.add(result.stepId);
        stepOutputs[result.stepId] = result.output;
      } else {
        failed.add(result.stepId);
      }
    }

    if (failed.size > 0) break;
  }

  if (failed.size > 0) {
    const error = `Workflow failed at step(s): ${Array.from(failed).join(', ')}`;
    await db
      .update(workflowStepRuns)
      .set({ status: 'blocked', error: 'A dependency failed', updatedAt: new Date() })
      .where(and(eq(workflowStepRuns.workflowRunId, runId), eq(workflowStepRuns.status, 'pending')));
    await db
      .update(workflowRuns)
      .set({
        status: 'failed',
        output: { steps: stepOutputs },
        error,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workflowRuns.id, runId));
    await recordWorkflowAudit({
      workflowId: run.workflowId,
      workflowRunId: runId,
      eventType: 'workflow_run.failed',
      detail: { failedSteps: Array.from(failed), output: stepOutputs },
    });
    return { runId, status: 'failed', output: { steps: stepOutputs }, error };
  }

  const output = { steps: stepOutputs };
  await db
    .update(workflowRuns)
    .set({
      status: 'succeeded',
      output,
      error: null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(workflowRuns.id, runId));
  await recordWorkflowAudit({
    workflowId: run.workflowId,
    workflowRunId: runId,
    eventType: 'workflow_run.succeeded',
    detail: { output },
  });

  return { runId, status: 'succeeded', output };
}
