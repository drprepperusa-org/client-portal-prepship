import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { settings } from '../db/schema/settings';
import {
  PRINT_QUEUE_MERGE_STATUS_KEY,
  PRINT_QUEUE_SEND_STATUS_KEY,
  type MergeJob,
  type MergeJobSnapshot,
  type QueueSendJob,
  type QueueSendJobSnapshot,
} from './print-queue-types';

/** Durable job-snapshot persistence for print-queue jobs (extracted from print-queue.ts). */

function toQueueSendSnapshot(job: QueueSendJob): QueueSendJobSnapshot {
  return {
    version: 1,
    durableKey: PRINT_QUEUE_SEND_STATUS_KEY,
    jobId: job.jobId,
    status: job.status,
    active: job.status === 'pending' || job.status === 'running',
    clientIds: [...job.clientIds],
    progress: job.progress,
    total: job.total,
    current: job.current,
    queued: job.queued,
    failed: job.failed,
    message: job.message,
    clientId: job.clientId ?? null,
    queuedEntryIds: [...job.queuedEntryIds],
    errorMessage: job.errorMessage ?? null,
    resultSamples: job.results.slice(-10).map((result) => ({
      orderId: result.orderId,
      success: result.success,
      queueEntryId: result.queueEntryId,
      alreadyQueued: result.alreadyQueued,
      trackingNumber: result.trackingNumber ?? null,
      error: result.error,
    })),
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
    persistedAt: new Date().toISOString(),
  };
}

function toMergeSnapshot(job: MergeJob): MergeJobSnapshot {
  return {
    version: 1,
    durableKey: PRINT_QUEUE_MERGE_STATUS_KEY,
    jobId: job.jobId,
    status: job.status,
    active: job.status === 'pending' || job.status === 'running',
    clientIds: [...job.clientIds],
    progress: job.progress,
    total: job.total,
    current: job.current,
    message: job.message,
    fileName: job.fileName ?? null,
    errorMessage: job.errorMessage ?? null,
    labelErrors: (job.labelErrors ?? []).slice(-10),
    createdAt: new Date(job.createdAt).toISOString(),
    persistedAt: new Date().toISOString(),
  };
}

export async function persistQueueSendJobSnapshot(job: QueueSendJob): Promise<void> {
  try {
    const value = JSON.stringify(toQueueSendSnapshot(job));
    await db
      .insert(settings)
      .values({ key: PRINT_QUEUE_SEND_STATUS_KEY, value })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value },
      });
  } catch (err) {
    console.warn(
      '[print-queue] failed to persist batch-send status:',
      err instanceof Error ? err.message : err
    );
  }
}

export async function persistMergeJobSnapshot(job: MergeJob): Promise<void> {
  try {
    const value = JSON.stringify(toMergeSnapshot(job));
    await db
      .insert(settings)
      .values({ key: PRINT_QUEUE_MERGE_STATUS_KEY, value })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value },
      });
  } catch (err) {
    console.warn(
      '[print-queue] failed to persist PDF-merge status:',
      err instanceof Error ? err.message : err
    );
  }
}

export async function getLatestQueueSendJobSnapshot(): Promise<QueueSendJobSnapshot | null> {
  try {
    const [row] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, PRINT_QUEUE_SEND_STATUS_KEY))
      .limit(1);
    if (!row?.value) return null;
    return JSON.parse(row.value) as QueueSendJobSnapshot;
  } catch (err) {
    console.warn(
      '[print-queue] failed to read batch-send durable status:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export async function getLatestMergeJobSnapshot(): Promise<MergeJobSnapshot | null> {
  try {
    const [row] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, PRINT_QUEUE_MERGE_STATUS_KEY))
      .limit(1);
    if (!row?.value) return null;
    return JSON.parse(row.value) as MergeJobSnapshot;
  } catch (err) {
    console.warn(
      '[print-queue] failed to read PDF-merge durable status:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
