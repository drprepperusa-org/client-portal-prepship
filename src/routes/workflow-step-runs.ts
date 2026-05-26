import { Hono } from 'hono';
import { requirePermission } from '../middleware/auth';
import { enqueueWorkflowRun } from '../services/workflows/queue';
import { markFailedStepForRetry } from '../services/workflows/store';

const app = new Hono();

app.post('/:id/retry', requirePermission('settings:write'), async (c) => {
  const stepRunId = Number(c.req.param('id'));
  if (!Number.isInteger(stepRunId) || stepRunId <= 0) return c.json({ error: 'Invalid workflow step run id' }, 400);
  try {
    const data = await markFailedStepForRetry({
      stepRunId,
      actor: { userId: c.get('userId'), email: c.get('email') },
    });
    const jobId = await enqueueWorkflowRun(data.run.id);
    return c.json({ ...data, jobId }, 202);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Workflow step retry failed' }, 400);
  }
});

export default app;
