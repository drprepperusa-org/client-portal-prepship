import { createClient } from '@supabase/supabase-js';
import { env } from './env';

export const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  }
);

// CP-030 — Return-inspection media storage (PRIVATE Supabase bucket).
//
// The 3PL receiving flow relays each captured photo/video to the backend, which
// uploads it here with the SERVICE role (the browser never holds that key). The
// DB persists only the durable object PATH; the client reads media through the
// short-lived signed URLs minted by getReturnMediaSignedUrl — the bucket is
// never public.

/** Upload an inspection media object to the private returns bucket. Throws on
 *  failure so the caller can surface a clean error and NOT persist a dead ref. */
export async function uploadReturnInspectionMedia(
  objectPath: string,
  body: ArrayBuffer | Uint8Array | Blob,
  contentType: string,
): Promise<void> {
  const { error } = await supabaseAdmin.storage
    .from(env.RETURNS_MEDIA_BUCKET)
    .upload(objectPath, body, { contentType, upsert: false });
  if (error) throw new Error(`Return inspection media upload failed: ${error.message}`);
}

/** Remove a just-uploaded private object when its owning DB write loses a race. */
export async function removeReturnInspectionMedia(objectPath: string): Promise<void> {
  const { error } = await supabaseAdmin.storage
    .from(env.RETURNS_MEDIA_BUCKET)
    .remove([objectPath]);
  if (error) throw new Error(`Return inspection media cleanup failed: ${error.message}`);
}

/** Mint a short-lived signed URL for a stored object path. Absolute http(s)
 *  refs (legacy/already-hosted) pass through unchanged. Returns null when the
 *  object cannot be signed (missing/renamed) so the caller can degrade to a
 *  "media unavailable" state instead of leaking an error. */
export async function getReturnMediaSignedUrl(
  storageRef: string,
  expiresIn: number = env.RETURNS_MEDIA_SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  if (/^https?:\/\//i.test(storageRef)) return storageRef;
  const { data, error } = await supabaseAdmin.storage
    .from(env.RETURNS_MEDIA_BUCKET)
    .createSignedUrl(storageRef, expiresIn);
  if (error || !data) return null;
  return data.signedUrl;
}
