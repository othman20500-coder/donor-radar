
# Cloudflare development V13 acceptance — 2026-11-19

Status: listed technical development acceptance checks passed, including R2. User acceptance and production approval remain separate.

- URL: https://donor-radar-v13-dev.othman20500.workers.dev
- D1: donor-radar-v13-dev, f7665d9e-7921-49d4-ab6d-076f0c67726c.
- No custom-domain routes, production databases, cPanel writes, or main-branch changes.
- Existing original interface and 74 protected assets retained. V13 extraction/discovery and review workflow adapted to Workers/D1.
- Local implementation branch: codex/cloudflare-v13-dev. Not pushed or merged.

## Verified

10 local tests passed using actual workerd/Miniflare and D1: anonymous protection, authentication/cookies/CSRF, roles, concurrent writes, last administrator, session invalidation, monitoring gates, backup validation, fresh-database snapshot restore, policy revocation between source requests, and mandatory password change (some tests cover multiple assertions).

Remote: all three test roles log in; anonymous app/monitor/asset requests redirect; editor/viewer cannot access administration; viewer cannot write; authenticated asset and state requests succeed. Browser login, main dashboard, project navigation, team area, monitoring UI and one scan succeeded. Attempt to accept evidence without dates was rejected.

A production-only runtime incompatibility was found and fixed: Workers rejected PBKDF2 600000 iterations despite local success. Authentication now uses native scrypt N=16384, r=8, p=5 with random 16-byte salts and 32-byte output. Test credentials were rotated; remote login retested successfully.

## Official source test

One request at 2026-11-19T08:32:42.751Z to https://www.gov.uk/guidance/find-government-grants succeeded. This is a technical fixture, not a Saudi grant recommendation. No linked pages or redirects were followed. No opportunity was automatically approved and no opening/closing date was fabricated.

Reviewed https://www.gov.uk/robots.txt and https://www.gov.uk/help/terms-conditions. Generic robots rules permit this guidance path; terms require lawful non-disruptive use and attribution for Crown content. Source retained; © Crown copyright, GOV.UK, Open Government Licence v3.0 where applicable. No republishing of retrieved content. Direct licence page returned 403 to research tooling; no broader licence determination claimed.

LIVE_SCAN_ENABLED=false and REVIEWED_SOURCE_URLS=[] after the single test. No scheduled scanning.

## Backups and recovery

Original package and verified Git bundle preserved outside this worktree. SQL export of the new development D1 is cloudflare/dev-database-backup.sql (ignored by Git, contains sensitive account hashes and possibly active session records). Restore verification imported it into a fresh in-memory SQLite database, cleared sessions/login attempts, and passed integrity_check and foreign_key_check. Counts: 3 accounts, 1 source, 1 policy, 1 observation, 1 evidence, 1 scan, 0 restored sessions.

Snapshot v2 includes users, meta, audit, records and monitoring tables. backup.mjs restoreFresh rejects a nonempty target atomically and omits sessions. Local test restored into a second D1 binding and checked foreign keys. Recovery must only target a newly created development database. Never use the production name or database ID.

## R2 acceptance completed (2026-11-19)

The user enabled R2. Dedicated bucket donor-radar-v13-dev-backups is bound as BACKUPS only in env.dev. r2.dev public access is disabled and no custom domains are connected. Actual remote tests passed: create/list/download, anonymous/viewer denial, snapshot v2 restore to a fresh local D1 with all table counts matching and no foreign-key errors or sessions, import preview and write with a pre-import backup, viewer rejection and stale revision rejection. Test data was restored to the pre-test state. The first test cleanup attempted an invalid zero financial target; cleanup was corrected to remove only the known test record, then the complete test passed. All 10 local tests passed again. Browser backup creation returned 201 and the saved backup list rendered. See r2-acceptance.mjs and local r2-results.json.

No production routing or main-branch changes. Live scanning remains disabled. Deployment version: ebc7c326-aa15-443d-a83f-66c326c6a952.

## Access

Development credentials are stored only in cloudflare/dev-credentials.json, excluded from Git. Do not paste this file into issues, logs or PRs. Change the administrator password through the team area when taking over. Screenshots: acceptance-home.png and acceptance-monitor.png.

## Reproduce

From cloudflare: npm ci; npm run build; npm test. Deployment uses --env dev only. Assets require private/catalog.json and private/app from the authorized local archive; these are deliberately excluded from Git. bootstrap.mjs refuses to overwrite existing credentials. verify-export.mjs validates the downloaded SQL locally. R2 restore is an operator-only process using restoreFresh against a fresh D1 binding; there is no web restore endpoint for full account snapshots.
