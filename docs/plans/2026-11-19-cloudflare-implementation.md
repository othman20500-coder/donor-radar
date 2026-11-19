# Cloudflare V13 Implementation Plan

**Goal:** Port the existing team application and V13 monitor into an isolated Workers/D1 development deployment.
**Architecture:** Worker Request/Response router, D1 SQL with atomic conditional batches, private asset binding/R2 attachments, fresh test users and sessions. Existing validators and interface remain the behavioral baseline.
**Tech Stack:** Workers, D1, Wrangler, Miniflare, Node test runner.

1. Preserve original Git bundle and package; create sibling worktree (done).
2. Add failing HTTP acceptance tests under cloudflare/tests for auth, CSRF, RBAC, concurrent writes, monitor policy gates, evidence, backups.
3. Implement schema and cloudflare/store.mjs with guarded atomic writes, account/session invalidation, audit trail and rate limiting. Test via real local D1 binding.
4. Implement cloudflare/worker.mjs with existing API shapes; adapt passwords to WebCrypto PBKDF2 for new development accounts only if current scrypt resource cost is unsuitable. No production credential migration.
5. Implement cloudflare/monitor.mjs with reviewed exact-source allowlist, bounded manual fetches, V13 extraction/evidence, and admin review routes.
6. Build the original interface and login from source, preserve private asset access. Recover only project attachments from verified archive entries, never production accounts/config/database.
7. Run HTTP acceptance tests on workerd and browser smoke tests, repair observed failures, independent code review.
8. Verify Cloudflare account access, create development-only resources and deploy. If authentication is unavailable, provide tested package and exact remaining blocker; never claim remote acceptance.
9. Review source policies before a live request; record results separately from mocks. Produce acceptance report and rollback instructions.

No main-branch pushes, DNS changes, production imports, or production deployment.

Implementation note (2026-11-19): actual edge testing rejected the planned PBKDF2 600000 configuration. Native scrypt N16384/r8/p5 was implemented and verified on the deployed development Worker. See cloudflare/ACCEPTANCE.md for actual results and the R2 blocker.
