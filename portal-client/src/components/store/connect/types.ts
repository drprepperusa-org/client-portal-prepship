import type { StorePlatform, StorePlatformCategory } from '@/data/storePlatforms';

export interface ConnectDraft {
  platform: StorePlatform;
  storeName: string;
  values: Record<string, string>;
}

export type StoreConnectFilter = StorePlatformCategory | 'all';

export interface StoreValidationState {
  ok: boolean;
  message: string;
}

export interface StoreValidationResult {
  ok: boolean;
  displayAccountIdentifier?: string;
  rateLimited?: boolean;
  message?: string;
}
