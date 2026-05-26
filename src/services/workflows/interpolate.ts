function getPath(source: unknown, path: string[]): unknown {
  let current = source;
  for (const part of path) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function resolveToken(
  token: string,
  context: {
    input: Record<string, unknown>;
    stepOutputs: Record<string, Record<string, unknown>>;
  },
): unknown {
  const trimmed = token.trim();
  if (trimmed.startsWith('input.')) {
    return getPath(context.input, trimmed.slice('input.'.length).split('.'));
  }
  if (trimmed.startsWith('steps.')) {
    const [, stepId, outputKeyword, ...path] = trimmed.split('.');
    if (outputKeyword !== 'output' || !stepId || path.length === 0) return undefined;
    return getPath(context.stepOutputs[stepId] ?? {}, path);
  }
  return undefined;
}

export function interpolateWorkflowValue(
  value: unknown,
  context: {
    input: Record<string, unknown>;
    stepOutputs: Record<string, Record<string, unknown>>;
  },
): unknown {
  if (typeof value === 'string') {
    const fullToken = value.match(/^\{\{\s*([^}]+)\s*\}\}$/);
    if (fullToken?.[1]) return resolveToken(fullToken[1], context);
    return value.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, token) => {
      const resolved = resolveToken(String(token), context);
      return resolved === undefined || resolved === null ? '' : String(resolved);
    });
  }

  if (Array.isArray(value)) return value.map((item) => interpolateWorkflowValue(item, context));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, interpolateWorkflowValue(item, context)]),
    );
  }
  return value;
}
