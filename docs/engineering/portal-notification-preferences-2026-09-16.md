# Account-backed notification preferences

## Outcome and owner

Each scoped portal user can choose Connection issues and Low-stock alerts from
the bell's Notification settings link (`/settings/notifications`). The existing
admin Settings tab uses the same form. User-management routes remain capability
gated; personal preferences do not grant any management capability.

Canonical storage is the authenticated user's Supabase Auth `user_metadata`
key `portal_notification_preferences`. The backend owner is
`src/lib/client-portal/notification-preferences.ts`. Only these two booleans are
accepted. Supabase merges the top-level metadata key; profile and app metadata
are not submitted. Target identity always comes from authenticated context,
never a request body, query parameter, browser storage or editable metadata.
These values affect display only, never authorization or business conditions.

Missing preferences default to both categories enabled. Malformed saved data or
an unavailable Auth service produces an unavailable response, never a fake save
or an all-clear response. The old unscoped browser-only preferences are not
migrated into any account. Shipment/invoice/weekly toggles are removed.

`GET /attention` reads current preferences and skips muted source categories;
their counts are zero, totalCount sums enabled categories only, and preferences
are included in the response. Existing stock/status/scope owners are unchanged.
Both-off has an explicit muted message rather than claiming no underlying issues.
Counts still follow selected client; preferences apply across the user's clients.

The form retains unsaved changes on failure, confirms the saved account response,
and clears/reloads the bell query after saving. Reads are keyed by user, recheck
on settings entry/focus, and the bell rechecks on open. Another device sees saved
choices on its next read; no realtime delivery is implied.

## Verification and release

- Disposable PostgreSQL + mocked Supabase Admin: defaults, full/partial mute,
  account isolation, preserved profile fields, invalid/extra fields, scope/auth
  denial, malformed metadata, failed read/save and canonical count behavior.
- Browser fixtures: ordinary non-manager access, two supported switches, saved
  badge/list changes, second independent browser context, reload, retry/draft
  retention, both-off message and mobile containment.
- Focused architecture, shadow-renderer, contract, access, auth-cache and UI checks;
  production build and bundle gates. Hosted CI runs the full suite on the commit.

No schema/migration, new dependency, auth-policy, worker or provider change.
No live account preference is changed as a test. Release uses the user's standing
direct-main/live authorization. Revert is schema-free; saved metadata is harmless
to the prior version. Supabase Auth is now a dependency of the attention read;
failure is explicitly unavailable and never falls back to guessed preferences.

API reference: https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid
Metadata merge owner: https://github.com/supabase/auth/blob/master/internal/models/user.go#L210
