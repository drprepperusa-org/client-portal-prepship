import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  workflowRuns,
  workflows,
  workflowStepRuns,
  workflowVersions,
} from '../../db/schema/workflows';
import { recordWorkflowAudit } from './audit';
import { validateWorkflowSpec } from './validation';
import type { WorkflowSpec } from './types';

export type WorkflowActor = {
  userId?: string | null;
  email?: string | null;
};

export async function createWorkflowDefinition(input: {
  spec: WorkflowSpec;
  actor: WorkflowActor;
  status?: 'draft' | 'active';
}) {
  const validation = validateWorkflowSpec(input.spec);
  if (!validation.ok || !validation.spec) {
    throw new Error(`Workflow validation failed: ${validation.errors.join('; ')}`);
  }

  const [workflow] = await db
    .insert(workflows)
    .values({
      name: validation.spec.name,
      description: validation.spec.description ?? null,
      status: input.status ?? 'draft',
      createdBy: input.actor.userId ?? null,
      createdByEmail: input.actor.email ?? null,
    })
    .returning();
  if (!workflow) throw new Error('Workflow insert failed');

  const [version] = await db
    .insert(workflowVersions)
    .values({
      workflowId: workflow.id,
      version: validation.spec.version,
      spec: validation.spec,
      validationSummary: {
        warnings: validation.warnings,
        actionCount: validation.spec.steps.length,
      },
      createdBy: input.actor.userId ?? null,
    })
    .returning();
  if (!version) throw new Error('Workflow version insert failed');

  await recordWorkflowAudit({
    workflowId: workflow.id,
    eventType: 'workflow.created',
    actorId: input.actor.userId,
    actorEmail: input.actor.email,
    detail: {
      versionId: version.id,
      status: workflow.status,
      warnings: validation.warnings,
    },
  });

  return { workflow, version, validation };
}

export async function listWorkflowDefinitions() {
  const rows = await db
    .select({
      workflow: workflows,
      version: workflowVersions,
    })
    .from(workflows)
    .leftJoin(workflowVersions, eq(workflowVersions.workflowId, workflows.id))
    .orderBy(desc(workflows.createdAt), desc(workflowVersions.version));

  const seen = new Set<number>();
  return rows
    .filter((row) => {
      if (seen.has(row.workflow.id)) return false;
      seen.add(row.workflow.id);
      return true;
    })
    .map((row) => ({
      ...row.workflow,
      latestVersion: row.version,
    }));
}

export async function getLatestWorkflowVersion(workflowId: number) {
  const [row] = await db
    .select()
    .from(workflowVersions)
    .where(eq(workflowVersions.workflowId, workflowId))
    .orderBy(desc(workflowVersions.version), desc(workflowVersions.createdAt))
    .limit(1);
  return row ?? null;
}

export async function createWorkflowRun(input: {
  workflowId: number;
  runInput: Record<string, unknown>;
  actor: WorkflowActor;
}) {
  const [workflow] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, input.workflowId))
    .limit(1);
  if (!workflow) throw new Error('Workflow not found');

  const version = await getLatestWorkflowVersion(input.workflowId);
  if (!version) throw new Error('Workflow version not found');

  const validation = validateWorkflowSpec(version.spec);
  if (!validation.ok || !validation.spec) {
    throw new Error(`Stored workflow validation failed: ${validation.errors.join('; ')}`);
  }

  const [run] = await db
    .insert(workflowRuns)
    .values({
      workflowId: workflow.id,
      workflowVersionId: version.id,
      status: 'queued',
      input: input.runInput,
      requestedBy: input.actor.userId ?? null,
      requestedByEmail: input.actor.email ?? null,
    })
    .returning();
  if (!run) throw new Error('Workflow run insert failed');

  await db.insert(workflowStepRuns).values(
    validation.spec.steps.map((step) => ({
      workflowRunId: run.id,
      stepId: step.id,
      action: step.action,
      status: 'pending',
    })),
  );

  await recordWorkflowAudit({
    workflowId: workflow.id,
    workflowRunId: run.id,
    eventType: 'workflow_run.queued',
    actorId: input.actor.userId,
    actorEmail: input.actor.email,
    detail: { workflowVersionId: version.id },
  });

  return { run, workflow, version };
}

export async function getWorkflowRunDetail(runId: number) {
  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
  if (!run) return null;
  const [version] = await db
    .select()
    .from(workflowVersions)
    .where(eq(workflowVersions.id, run.workflowVersionId))
    .limit(1);
  const steps = await db
    .select()
    .from(workflowStepRuns)
    .where(eq(workflowStepRuns.workflowRunId, run.id))
    .orderBy(workflowStepRuns.id);
  return { run, version, steps };
}

export async function cancelWorkflowRun(input: { runId: number; actor: WorkflowActor }) {
  const now = new Date();
  const [run] = await db
    .update(workflowRuns)
    .set({
      status: 'cancelled',
      finishedAt: now,
      updatedAt: now,
      error: 'Cancelled by user',
    })
    .where(eq(workflowRuns.id, input.runId))
    .returning();
  if (!run) throw new Error('Workflow run not found');

  await db
    .update(workflowStepRuns)
    .set({ status: 'cancelled', updatedAt: now })
    .where(
      and(
        eq(workflowStepRuns.workflowRunId, input.runId),
        eq(workflowStepRuns.status, 'pending'),
      ),
    );

  await recordWorkflowAudit({
    workflowId: run.workflowId,
    workflowRunId: run.id,
    eventType: 'workflow_run.cancelled',
    actorId: input.actor.userId,
    actorEmail: input.actor.email,
  });

  return run;
}

export async function markFailedStepForRetry(input: {
  stepRunId: number;
  actor: WorkflowActor;
}) {
  const [step] = await db
    .update(workflowStepRuns)
    .set({
      status: 'pending',
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(workflowStepRuns.id, input.stepRunId))
    .returning();
  if (!step) throw new Error('Workflow step run not found');

  const [run] = await db
    .update(workflowRuns)
    .set({
      status: 'queued',
      error: null,
      finishedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(workflowRuns.id, step.workflowRunId))
    .returning();
  if (!run) throw new Error('Workflow run not found');

  await recordWorkflowAudit({
    workflowId: run.workflowId,
    workflowRunId: run.id,
    workflowStepRunId: step.id,
    eventType: 'workflow_step.retry_queued',
    actorId: input.actor.userId,
    actorEmail: input.actor.email,
  });

  return { run, step };
}
