# Verification — 2026-09-23

## Automated API tests
- Actual HTTP server plus temporary SQLite database; 8 tests passing.
- Shared submissions and reopening the same database.
- Retried/concurrent submission request ID stores once.
- Two visitor sessions, idempotent hearts, cancellation and persistence.
- Empty, whitespace-only, non-string, overlong fields; 200 emoji accepted.
- Missing story, invalid heart state, malformed JSON, cross-origin POST rejection.
- Configured public QR URL and private file route exclusion.
- UTF-8 multibyte character split across actual HTTP chunks preserved.
- QR/config requests do not overwrite participant identity cookies.

## Browser checks (separate test database, port 4978)
- Desktop layout at 1280px, mobile at 390px; no horizontal overflow (mobile scroll width 375px within 390px viewport).
- Draft survives tab switching and page reload.
- Successful form submission, success state, shared board, persisted after server restart.
- Separate localhost and 127.0.0.1 participant cookies see the same story; independent hearts sum from 1 to 2, cancellation reduces to 1.
- Mobile 201-character input blocks submission with validation; corrected input submits successfully.
- Search by nickname filters cards; clearing search restores them; heart sorting places a liked example first.
- Story enlargement and QR enlargement show matching content and participation URL.
- Example stories are clearly labelled and excluded from actual statistics.

## Independent review
Found and fixed split UTF-8 body decoding and first-page QR/session cookie race; added failing regression cases, then verified both pass.

## Deployment scope
No public internet hosting provisioned, no firewall changes. Local phone connectivity depends on the network allowing access to the host. Automated tests do not claim an external phone scan was performed.

## Vercel / Supabase update
- Requested copy removals and tab renaming applied; form heading punctuation uses the same ink color as the heading.
- Added Supabase Postgres adapter with parameterized queries and transactional schema initialization.
- Six additional tests on PGlite (actual PostgreSQL engine) cover cross-instance persistence, retry-safe inserts, shared/idempotent/cancellable hearts, invalid input and literal SQL-looking content.
- HTTP routes await async Postgres operations; HTTPS QR and Secure cookies in deployment mode.
- Vercel without DATABASE_URL/POSTGRES_URL rejects saves with 503; no temporary-file fallback.
- Full suite: 14 passing tests. Independent review found no further actionable bugs. Actual hosted Supabase connectivity and Vercel build/deployment remain unverified until the user's account/database is connected.

- Supabase migration: Postgres.js Transaction pooler support, unnamed queries (prepare=false), bounded connection pool, TLS certificate verification, asynchronous connection cleanup.
- RLS regression verified: browser role with table grants cannot read stories/hearts or insert rows; server owner continues to save and read.


## Ownership and admin management update
- Removed the board write-story link and heart encouragement note.
- Added owner-only editing/removal and server-verified admin login (default password 0000), with visitor-bound signed HttpOnly sessions.
- Tests cover SQLite/PostgreSQL atomic permissions, preserved metadata/hearts during edits, cascading deletion, forged flags/cookies, wrong passwords, cross-instance admin sessions, and unconfigured deployments.
- Full automated suite: 21 passed. Browser QA verified owner controls, saved edits with retained hearts, absent controls for another visitor, admin login/editing, delete confirmation/cancel, and logout removing admin controls.
- Review identified a busy-dialog backdrop race; backdrop/open guards now preserve pending operations.
- Hosted Supabase connectivity remains unverified until DATABASE_URL is configured.

## Vercel production 404 fix
- Found uploaded app under workshop-stories-github while Root Directory was empty; corrected project setting.
- Replaced unsupported server.mjs function matching with api/index.mjs and a catch-all rewrite.
- Added pre-parsed JSON request support and two entrypoint regression tests; 23 tests pass.
- Bundled official Supabase Root 2021 CA for verified TLS; certificate and hostname verification remain enabled.
- Production verification passed at https://class-five-alpha.vercel.app: create, shared read, heart, owner edit preserving heart, delete. Only the verification story was removed.
