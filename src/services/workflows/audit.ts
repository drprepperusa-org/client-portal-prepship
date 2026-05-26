import { db } from '../../db/client';
import { workflowActionAuditLogs } from '../../db/schema/workflows';

export type WorkflowAuditInput = {
  workflowId?: number | null;
  workflowRunId?: number | null;
  workflowStepRunId?: number | null;
  eventType: string;
  actorId?: string | null;
  actorEmail?: string | null;
  detail?: Record<string, unknown>;
};

export async function recordWorkflowAudit(input: WorkflowAuditInput): Promise<void> {
  await db.insert(workflowActionAuditLogs).values({
    workflowId: input.workflowId ?? null,
    workflowRunId: input.workflowRunId ?? null,
    workflowStepRunId: input.workflowStepRunId ?? null,
    eventType: input.eventType,
    actorId: input.actorId ?? null,
    actorEmail: input.actorEmail ?? null,
    detail: input.detail ?? {},
  });
}
