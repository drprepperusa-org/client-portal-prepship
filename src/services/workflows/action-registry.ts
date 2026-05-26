import { z } from 'zod';
import type { WorkflowActionDefinition } from './types';

const passthroughRecord = z.record(z.unknown());

function deterministicId(prefix: string, value: unknown): string {
  const normalized = JSON.stringify(value ?? {});
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  return `${prefix}_${hash.toString(16).padStart(8, '0')}`;
}

const lookupSkuInput = z.object({
  barcode: z.string().min(1),
  clientId: z.union([z.string(), z.number()]).optional(),
});

const receiveInput = z.object({
  sku: z.string().min(1),
  quantity: z.coerce.number().int().positive(),
  bin: z.string().min(1).optional(),
  barcode: z.string().min(1).optional(),
});

const notifyInput = z.object({
  clientId: z.union([z.string(), z.number()]).optional(),
  message: z.string().min(1).optional(),
});

const invoiceDraftInput = z.object({
  clientId: z.union([z.string(), z.number()]),
  amount: z.coerce.number().nonnegative().optional(),
});

async function executeReceiveDraft(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const parsed = receiveInput.parse(input);
  return {
    receiptDraftId: deterministicId('receipt', parsed),
    sku: parsed.sku,
    quantity: parsed.quantity,
    bin: parsed.bin ?? null,
    committed: false,
    note: 'Draft only: live inventory was not changed.',
  };
}

async function executeNotificationDraft(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const parsed = notifyInput.parse(input);
  return {
    notificationDraftId: deterministicId('notification', parsed),
    clientId: parsed.clientId ?? null,
    queued: false,
    note: 'Draft only: no email, SMS, or marketplace notification was sent.',
  };
}

export const workflowActionRegistry: Record<string, WorkflowActionDefinition> = {
  'inventory.lookupSku': {
    name: 'inventory.lookupSku',
    description: 'Safely resolves a scanned barcode to a draft SKU payload.',
    mutatesData: false,
    requiredPermission: 'settings:read',
    inputSchema: lookupSkuInput,
    outputSchema: passthroughRecord,
    async execute(input) {
      const parsed = lookupSkuInput.parse(input);
      return {
        sku: `SKU-${parsed.barcode}`.toUpperCase(),
        barcode: parsed.barcode,
        clientId: parsed.clientId ?? null,
        found: true,
        source: 'workflow-demo-action',
      };
    },
  },
  'orders.lookup': {
    name: 'orders.lookup',
    description: 'Safe order lookup placeholder for orchestration planning.',
    mutatesData: false,
    requiredPermission: 'settings:read',
    inputSchema: passthroughRecord,
    outputSchema: passthroughRecord,
    async execute(input) {
      return { matched: true, criteria: input, source: 'workflow-demo-action' };
    },
  },
  'inventory.receiveIntoBin': {
    name: 'inventory.receiveIntoBin',
    description: 'Creates a receipt draft result without mutating live inventory.',
    mutatesData: false,
    requiredPermission: 'settings:write',
    inputSchema: receiveInput,
    outputSchema: passthroughRecord,
    execute: executeReceiveDraft,
  },
  'inventory.receive': {
    name: 'inventory.receive',
    description: 'Alias for safe receipt draft generation.',
    mutatesData: false,
    requiredPermission: 'settings:write',
    inputSchema: receiveInput,
    outputSchema: passthroughRecord,
    execute: executeReceiveDraft,
  },
  'inventory.assignBin': {
    name: 'inventory.assignBin',
    description: 'Creates a bin assignment draft without changing stock.',
    mutatesData: false,
    requiredPermission: 'settings:write',
    inputSchema: receiveInput,
    outputSchema: passthroughRecord,
    async execute(input) {
      const parsed = receiveInput.parse(input);
      return {
        assignmentDraftId: deterministicId('bin', parsed),
        sku: parsed.sku,
        bin: parsed.bin ?? 'unassigned',
        committed: false,
      };
    },
  },
  'client.notifyInventoryReceived': {
    name: 'client.notifyInventoryReceived',
    description: 'Creates a notification draft without sending live messages.',
    mutatesData: false,
    requiredPermission: 'settings:write',
    inputSchema: notifyInput,
    outputSchema: passthroughRecord,
    execute: executeNotificationDraft,
  },
  'client.notify': {
    name: 'client.notify',
    description: 'Alias for safe client notification draft generation.',
    mutatesData: false,
    requiredPermission: 'settings:write',
    inputSchema: notifyInput,
    outputSchema: passthroughRecord,
    execute: executeNotificationDraft,
  },
  'invoice.createDraft': {
    name: 'invoice.createDraft',
    description: 'Creates a billing draft result without charging or posting an invoice.',
    mutatesData: false,
    requiredPermission: 'settings:write',
    inputSchema: invoiceDraftInput,
    outputSchema: passthroughRecord,
    async execute(input) {
      const parsed = invoiceDraftInput.parse(input);
      return {
        invoiceDraftId: deterministicId('invoice', parsed),
        clientId: parsed.clientId,
        amount: parsed.amount ?? null,
        committed: false,
      };
    },
  },
};

export function getWorkflowAction(name: string): WorkflowActionDefinition | null {
  return workflowActionRegistry[name] ?? null;
}

export function listWorkflowActions(): WorkflowActionDefinition[] {
  return Object.values(workflowActionRegistry);
}
