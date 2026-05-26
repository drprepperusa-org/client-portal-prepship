import { getWorkflowAction } from './action-registry';
import { workflowSpecSchema, type WorkflowSpec } from './types';

export type WorkflowValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  spec?: WorkflowSpec;
};

const forbiddenMutationPatterns = [
  /shipments?\.(create|update|delete|mutate)/i,
  /orders?\.(ship|cancel|delete|void|refund|purchaseLabel|buyLabel)/i,
  /label\.(create|purchase|void)/i,
  /postage\.(purchase|refund)/i,
  /marketplace\.(notify|confirm|cancel)/i,
];

export function validateWorkflowSpec(input: unknown): WorkflowValidationResult {
  const parsed = workflowSpecSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      warnings: [],
    };
  }

  const spec = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();

  for (const step of spec.steps) {
    if (ids.has(step.id)) errors.push(`Duplicate step id: ${step.id}`);
    ids.add(step.id);

    if (!getWorkflowAction(step.action)) errors.push(`Unknown workflow action: ${step.action}`);
    if (forbiddenMutationPatterns.some((pattern) => pattern.test(step.action))) {
      errors.push(`Forbidden production mutation action: ${step.action}`);
    }
    if (step.retry.maxAttempts > 3) {
      warnings.push(`Step ${step.id} retries ${step.retry.maxAttempts} times; review API rate limits.`);
    }
  }

  for (const step of spec.steps) {
    for (const dependency of step.dependsOn) {
      if (!ids.has(dependency)) errors.push(`Step ${step.id} depends on unknown step ${dependency}`);
      if (dependency === step.id) errors.push(`Step ${step.id} cannot depend on itself`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(spec.steps.map((step) => [step.id, step]));

  function visit(stepId: string, path: string[]): void {
    if (visited.has(stepId)) return;
    if (visiting.has(stepId)) {
      errors.push(`Workflow dependency cycle detected: ${[...path, stepId].join(' -> ')}`);
      return;
    }
    visiting.add(stepId);
    for (const dependency of byId.get(stepId)?.dependsOn ?? []) visit(dependency, [...path, stepId]);
    visiting.delete(stepId);
    visited.add(stepId);
  }

  for (const step of spec.steps) visit(step.id, []);

  return { ok: errors.length === 0, errors, warnings, spec };
}
