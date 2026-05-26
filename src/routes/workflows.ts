import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requirePermission } from '../middleware/auth';
import { listWorkflowActions } from '../services/workflows/action-registry';
import {
  createWorkflowDefinition,
  createWorkflowRun,
  listWorkflowDefinitions,
} from '../services/workflows/store';
import { enqueueWorkflowRun } from '../services/workflows/queue';
import { validateWorkflowSpec } from '../services/workflows/validation';
import { workflowSpecSchema } from '../services/workflows/types';

const app = new Hono();

const createWorkflowBody = z.object({
  spec: workflowSpecSchema,
  status: z.enum(['draft', 'active']).default('draft'),
});

const startRunBody = z.object({
  input: z.record(z.unknown()).default({}),
});

app.get('/', requirePermission('settings:read'), async (c) => {
  const data = await listWorkflowDefinitions();
  return c.json({ data });
});

app.get('/actions', requirePermission('settings:read'), async (c) => {
  return c.json({
    data: listWorkflowActions().map((action) => ({
      name: action.name,
      description: action.description,
      mutatesData: action.mutatesData,
      requiredPermission: action.requiredPermission,
    })),
  });
});

app.post('/validate', requirePermission('settings:write'), zValidator('json', workflowSpecSchema), async (c) => {
  const validation = validateWorkflowSpec(c.req.valid('json'));
  return c.json(validation, validation.ok ? 200 : 400);
});

app.post('/', requirePermission('settings:write'), zValidator('json', createWorkflowBody), async (c) => {
  try {
    const { spec, status } = c.req.valid('json');
    const data = await createWorkflowDefinition({
      spec,
      status,
      actor: { userId: c.get('userId'), email: c.get('email') },
    });
    return c.json(data, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Workflow creation failed' }, 400);
  }
});

app.post('/:id/runs', requirePermission('settings:write'), zValidator('json', startRunBody), async (c) => {
  const workflowId = Number(c.req.param('id'));
  if (!Number.isInteger(workflowId) || workflowId <= 0) return c.json({ error: 'Invalid workflow id' }, 400);
  try {
    const data = await createWorkflowRun({
      workflowId,
      runInput: c.req.valid('json').input,
      actor: { userId: c.get('userId'), email: c.get('email') },
    });
    const jobId = await enqueueWorkflowRun(data.run.id);
    return c.json({ ...data, jobId }, 202);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Workflow run failed to queue' }, 400);
  }
});

export default app;
