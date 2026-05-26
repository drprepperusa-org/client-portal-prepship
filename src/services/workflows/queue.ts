import PgBoss from 'pg-boss';
import { env } from '../../lib/env';
import { executeWorkflowRun } from './executor';

const WORKFLOW_RUN_QUEUE = 'prepship.workflow.run';

let workerBoss: PgBoss | null = null;
let enqueueBoss: PgBoss | null = null;
let workerStarted = false;

async function startBoss(applicationName: string): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: env.PG_BOSS_SCHEMA,
    application_name: applicationName,
    max: 1,
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInMinutes: 60,
    retentionDays: 14,
    deleteAfterDays: 14,
  });
  boss.on('error', (err) => {
    console.error(`[workflow-queue:${applicationName}] pg-boss error:`, err.message);
  });
  await boss.start();
  await boss.createQueue(WORKFLOW_RUN_QUEUE, {
    name: WORKFLOW_RUN_QUEUE,
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInMinutes: 60,
    retentionDays: 14,
  });
  return boss;
}

export async function enqueueWorkflowRun(runId: number): Promise<string | null> {
  if (!enqueueBoss) enqueueBoss = await startBoss('prepship-api-workflow-enqueue');
  return enqueueBoss.send(
    WORKFLOW_RUN_QUEUE,
    { runId },
    {
      singletonKey: `workflow-run-${runId}`,
      singletonSeconds: 24 * 60 * 60,
      retryLimit: 2,
      retryDelay: 30,
      retryBackoff: true,
      expireInMinutes: 60,
      retentionDays: 14,
    },
  );
}

export async function startWorkflowWorkerQueue(): Promise<void> {
  if (workerStarted) {
    console.warn('[workflow-queue] already started, ignoring duplicate start');
    return;
  }
  workerStarted = true;
  workerBoss = await startBoss('prepship-worker-workflows');
  await workerBoss.work(
    WORKFLOW_RUN_QUEUE,
    { batchSize: 1, pollingIntervalSeconds: 5 },
    async ([job]) => {
      const data = job?.data as { runId?: unknown } | undefined;
      const runId = Number(data?.runId);
      if (!Number.isInteger(runId) || runId <= 0) {
        throw new Error(`Invalid workflow run id in job ${job?.id ?? 'unknown'}`);
      }
      console.log(`[workflow-queue] executing workflow run ${runId}`);
      return executeWorkflowRun(runId);
    },
  );
  console.log('[workflow-queue] worker started');
}

export async function stopWorkflowWorkerQueue(): Promise<void> {
  if (workerBoss) {
    await workerBoss.stop({ graceful: true, timeout: 30_000 });
    workerBoss = null;
  }
  workerStarted = false;
  console.log('[workflow-queue] worker stopped');
}
