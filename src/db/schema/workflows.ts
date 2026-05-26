import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const workflows = pgTable(
  'workflows',
  {
    id: serial().primaryKey(),
    name: text().notNull(),
    description: text(),
    status: text().default('draft').notNull(),
    createdBy: text('created_by'),
    createdByEmail: text('created_by_email'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('workflows_status_idx').on(t.status),
    index('workflows_created_at_idx').on(t.createdAt),
  ],
);

export const workflowVersions = pgTable(
  'workflow_versions',
  {
    id: serial().primaryKey(),
    workflowId: integer('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    version: integer().notNull(),
    spec: jsonb().$type<Record<string, unknown>>().notNull(),
    validationSummary: jsonb('validation_summary')
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('workflow_versions_workflow_idx').on(t.workflowId),
    index('workflow_versions_workflow_version_idx').on(t.workflowId, t.version),
  ],
);

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: serial().primaryKey(),
    workflowId: integer('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    workflowVersionId: integer('workflow_version_id')
      .notNull()
      .references(() => workflowVersions.id, { onDelete: 'cascade' }),
    status: text().default('queued').notNull(),
    input: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
    output: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
    error: text(),
    requestedBy: text('requested_by'),
    requestedByEmail: text('requested_by_email'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('workflow_runs_workflow_idx').on(t.workflowId),
    index('workflow_runs_status_idx').on(t.status),
    index('workflow_runs_created_at_idx').on(t.createdAt),
  ],
);

export const workflowStepRuns = pgTable(
  'workflow_step_runs',
  {
    id: serial().primaryKey(),
    workflowRunId: integer('workflow_run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    stepId: text('step_id').notNull(),
    action: text().notNull(),
    status: text().default('pending').notNull(),
    attempt: integer().default(0).notNull(),
    input: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
    output: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
    error: text(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('workflow_step_runs_run_idx').on(t.workflowRunId),
    index('workflow_step_runs_step_idx').on(t.workflowRunId, t.stepId),
    index('workflow_step_runs_status_idx').on(t.status),
  ],
);

export const workflowActionAuditLogs = pgTable(
  'workflow_action_audit_logs',
  {
    id: serial().primaryKey(),
    workflowId: integer('workflow_id').references(() => workflows.id, {
      onDelete: 'set null',
    }),
    workflowRunId: integer('workflow_run_id').references(() => workflowRuns.id, {
      onDelete: 'set null',
    }),
    workflowStepRunId: integer('workflow_step_run_id').references(
      () => workflowStepRuns.id,
      { onDelete: 'set null' },
    ),
    eventType: text('event_type').notNull(),
    actorId: text('actor_id'),
    actorEmail: text('actor_email'),
    detail: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('workflow_action_audit_workflow_idx').on(t.workflowId),
    index('workflow_action_audit_run_idx').on(t.workflowRunId),
    index('workflow_action_audit_created_at_idx').on(t.createdAt),
  ],
);

export const workflowApiConnections = pgTable(
  'workflow_api_connections',
  {
    id: serial().primaryKey(),
    name: text().notNull(),
    service: text().notNull(),
    credentialsRef: text('credentials_ref'),
    status: text().default('active').notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('workflow_api_connections_service_idx').on(t.service),
    index('workflow_api_connections_status_idx').on(t.status),
  ],
);

export type Workflow = typeof workflows.$inferSelect;
export type WorkflowVersion = typeof workflowVersions.$inferSelect;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type WorkflowStepRun = typeof workflowStepRuns.$inferSelect;
