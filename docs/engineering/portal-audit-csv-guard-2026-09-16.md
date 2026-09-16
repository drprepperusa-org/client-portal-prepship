# Backend audit CSV guard compatibility

## Placement and success criteria

Hosted CI for 4dbe3eb failed because the invoice no-local-builder guard treated
the audit API's CSV Accept header and UI response-type validation as file builders.
The backend remains the CSV owner; the browser still downloads its original Blob.
This correction changes verification only, with no application or data changes.

Keep the global media scan. Remove only the two reviewed expressions from the scan,
requiring exactly one occurrence in each exact file. Do not allowlist directories
or skip whole files. Additional CSV literals, data URIs and local builders still
fail. Pin the audit API to its bare apiBlob return and the UI to the shared
downloadFile sink with the original file.bytes. Retain every existing invoice
identity, wiring, media, source-of-truth and proxy assertion.

Extend the existing mutation harness with audit Blob reconstruction, extra media
literals in both allowed files, and API response replacement. All original invoice
mutations must still be killed, and the harness must restore every mutated file.

## Release

Base/rollback: 4dbe3ebf54344d631a036832b428d86aa7732c18. Run focused builder and
mutation tests, typechecks and the complete static suite. Push to main under user
authorization, await the complete hosted CI run, and verify production commit
parity/readiness. No dependencies, migrations, runtime or business-data changes.

## Local verification

- The builder guard passes all 10 assertions.
- All 15 mutation cases are rejected, including the 11 original invoice cases
  and four new audit cases. The harness restored every temporarily modified file.
- Backend/frontend typechecks and production build/bundle budget pass.
- The complete 186-check static runner passes, including its full-site
  certification, auth/access/scope/redaction, invoice and audit runtime suites.
- API/frontend dependency manifests match their lockfiles; no dependencies changed.
