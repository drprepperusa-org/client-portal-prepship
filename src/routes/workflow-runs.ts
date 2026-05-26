import { Hono } from 'hono';
import { requirePermission } from '../middleware/auth';
import { cancelWorkflowRun, getWorkflowRunDetail } from '../services/workflows/store';

const app = new Hono();

app.get('/:id', requirePermission('settings:read'), async (c) => {
  const runId = Number(c.req.param('id'));
  if (!Number.isInteger(runId) || runId <= 0) return c.json({ error: 'Invalid workflow run id' }, 400);
  const detail = await getWorkflowRunDetail(runId);
  if (!detail) return c.json({ error: 'Workflow run not found' }, 404);
  return c.json(detail);
});

app.post('/:id/cancel', requirePermission('settings:write'), async (c) => {
  const runId = Number(c.req.param('id'));
  if (!Number.isInteger(runId) || runId <= 0) return c.json({ error: 'Invalid workflow run id' }, 400);
  try {
    const run = await cancelWorkflowRun({
      runId,
      actor: { userId: c.get('userId'), email: c.get('email') },
    });
    return c.json({ run });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Workflow run cancel failed' }, 400);
  }
});

export default app;
