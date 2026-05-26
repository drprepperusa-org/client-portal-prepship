import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

const schema = read('src/db/schema/workflows.ts');
const migration = read('drizzle/0035_ai_workflow_orchestration.sql');
const types = read('src/services/workflows/types.ts');
const validation = read('src/services/workflows/validation.ts');
const registry = read('src/services/workflows/action-registry.ts');
const executor = read('src/services/workflows/executor.ts');
const queue = read('src/services/workflows/queue.ts');
const main = read('src/main.ts');
const worker = read('src/worker.ts');
const specialists = read('src/services/workflows/subagents.ts');
const pkg = JSON.parse(read('package.json'));
const forbiddenAiKeyEnv = ['OPEN', 'AI_API_KEY'].join('');
const forbiddenPlannerRoute = ['/ai', '/workflows'].join('');

for (const table of [
  'workflows',
  'workflow_versions',
  'workflow_runs',
  'workflow_step_runs',
  'workflow_action_audit_logs',
  'workflow_api_connections',
]) {
  assert(schema.includes(table), `Drizzle schema includes ${table}`);
  assert(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `migration creates ${table}`);
}

assert(types.includes('workflowSpecSchema'), 'workflow DSL has a Zod spec schema');
assert(types.includes('WorkflowActionDefinition'), 'workflow action registry type is defined');
assert(validation.includes('Unknown workflow action'), 'validation rejects unknown actions');
assert(validation.includes('Forbidden production mutation action'), 'validation blocks risky production mutations');
assert(!executor.includes('eval('), 'executor does not use eval');
assert(!executor.includes('new Function'), 'executor does not construct functions dynamically');
assert(executor.includes('Promise.all'), 'executor supports parallel ready-step execution');
assert(executor.includes('maxAttempts'), 'executor applies retry attempts');
assert(registry.includes('Draft only: live inventory was not changed'), 'WMS action is draft-only');
assert(registry.includes('no email, SMS, or marketplace notification was sent'), 'notification action is draft-only');
assert(!main.includes(`app.route('${forbiddenPlannerRoute}'`), 'external planner route is not mounted');
assert(!read('src/lib/env.ts').includes(forbiddenAiKeyEnv), 'external AI key env is not required');
assert(specialists.includes('Workflow Architect'), 'subagent specialist roster includes Workflow Architect');
assert(specialists.includes('UI/UX Designer'), 'subagent specialist roster includes UI/UX Designer');
assert(specialists.includes('Frontend Developer'), 'subagent specialist roster includes Frontend Developer');
assert(specialists.includes('Security Reviewer'), 'subagent specialist roster includes Security Reviewer');
assert(queue.includes('prepship.workflow.run'), 'pg-boss workflow queue is registered');
assert(worker.includes('startWorkflowWorkerQueue'), 'worker starts workflow queue');
assert(main.includes("app.route('/workflows'"), 'main mounts workflow route');
assert(main.includes("app.route('/workflow-runs'"), 'main mounts workflow run route');
assert(main.includes("app.route('/workflow-step-runs'"), 'main mounts workflow step retry route');
assert(pkg.scripts?.['test:workflow-orchestration'] === 'node scripts/workflow-orchestration-guard.mjs', 'package exposes workflow orchestration guard');

if (process.exitCode) process.exit(process.exitCode);
console.log('Workflow orchestration guard passed');
