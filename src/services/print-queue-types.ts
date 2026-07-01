import type { CreateLabelInputDto } from './labels';

/** Shared print-queue types + durable status keys (extracted from print-queue.ts). */

export type AddToQueueInput = {
  clientId: number;
  orderId: string;
  orderNumber?: string | null;
  labelUrl: unknown;
  skuGroupId: string;
  primarySku?: string | null;
  itemDescription?: string | null;
  orderQty?: number;
  multiSkuData?: { sku: string; qty: number }[] | null;
  scope?: PrintQueueListScope;
};

export type MergeJob = {
  jobId: string;
  status: 'pending' | 'running' | 'done' | 'error';
  clientIds: number[];
  progress: number;
  total: number;
  current: number;
  message: string;
  mergedPdfBase64?: string;
  fileName?: string;
  errorMessage?: string;
  labelErrors?: string[];
  createdAt: number;
};

export type QueueSendOrderInput = {
  orderId: number;
  clientId: number;
  orderNumber?: string | null;
  labelUrl?: unknown | null;
  label?: Omit<CreateLabelInputDto, 'orderId' | 'orderNumber'> & {
    orderId?: number;
    orderNumber?: string;
  };
  skuGroupId: string;
  primarySku?: string | null;
  itemDescription?: string | null;
  orderQty?: number;
  multiSkuData?: { sku: string; qty: number }[] | null;
};

export type QueueSendJobResult = {
  orderId: number;
  success: boolean;
  queueEntryId?: string;
  alreadyQueued?: boolean;
  labelUrl?: string | null;
  trackingNumber?: string | null;
  error?: string;
};

export type QueueSendJob = {
  jobId: string;
  status: 'pending' | 'running' | 'done' | 'error';
  clientIds: number[];
  progress: number;
  total: number;
  current: number;
  queued: number;
  failed: number;
  message: string;
  clientId?: number | null;
  createdAt: number;
  updatedAt: number;
  results: QueueSendJobResult[];
  queuedEntryIds: string[];
  errorMessage?: string;
};

export const PRINT_QUEUE_SEND_STATUS_KEY = 'print_queue.batch_send.last_run';
export const PRINT_QUEUE_MERGE_STATUS_KEY = 'print_queue.pdf_merge.last_run';

export type QueueSendResultSnapshot = {
  orderId: number;
  success: boolean;
  queueEntryId?: string;
  alreadyQueued?: boolean;
  trackingNumber?: string | null;
  error?: string;
};

export type QueueSendJobSnapshot = {
  version: 1;
  durableKey: typeof PRINT_QUEUE_SEND_STATUS_KEY;
  jobId: string;
  status: QueueSendJob['status'];
  active: boolean;
  clientIds: number[];
  progress: number;
  total: number;
  current: number;
  queued: number;
  failed: number;
  message: string;
  clientId: number | null;
  queuedEntryIds: string[];
  errorMessage: string | null;
  resultSamples: QueueSendResultSnapshot[];
  createdAt: string;
  updatedAt: string;
  persistedAt: string;
};

export type MergeJobSnapshot = {
  version: 1;
  durableKey: typeof PRINT_QUEUE_MERGE_STATUS_KEY;
  jobId: string;
  status: MergeJob['status'];
  active: boolean;
  clientIds: number[];
  progress: number;
  total: number;
  current: number;
  message: string;
  fileName: string | null;
  errorMessage: string | null;
  labelErrors: string[];
  createdAt: string;
  persistedAt: string;
};

export type PrintQueueListScope = {
  scopeClientIds?: number[];
  scopeStoreIds?: number[];
  scopeRestricted?: boolean;
};
