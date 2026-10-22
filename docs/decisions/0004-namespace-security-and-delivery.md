# ADR 0004: namespace roles and separate public sample delivery

Status: accepted for the local workshop.

## Requirement and context

The teaching system needs sharing that can be checked on every server request. It also needs a public static demonstration without pretending that a static host provides private persistent storage or server authorization.

## Decision

Map three configured local bearer tokens to Alice, Bob, and Eve. Bind to loopback by default. Authorize each request against namespace membership: owner, writer, or reader. Only an owner shares or permanently purges. Sessions also belong to their initiating actor. Keep sharing namespace-wide; do not introduce inherited folder exceptions.

Build full local and public sample browser modes separately. The full mode talks to the same-origin API. The static Pages mode uses explicitly authored public samples and directs mutations to the full application. No Google login, API, or backend is involved.

## Alternatives considered

| Alternative | Tradeoff |
| --- | --- |
| Per-file or inherited folder ACLs | More flexible, with ancestor evaluation, move semantics, exception precedence, and broader authorization test surface |
| Public unguessable file links | A distinct bearer-capability product requiring expiry/revocation and leakage policy; UUIDs are not such capabilities here |
| Full account/OIDC service | Appropriate for a production trust boundary but adds enrollment, session lifecycle, identity provider and TLS setup beyond the local lab |
| Ship a live database snapshot to Pages | Exposes private metadata/content and cannot enforce backend roles; unacceptable for a public sample |
| One UI silently switching to local mock writes | Misrepresents durability and permissions; a sample must state its boundary visibly |

## Consequences and tradeoff

Authorization is understandable and reusable across snapshot, changes, revisions, download, and retry paths. The product cannot express a private subtree inside a shared namespace. Revocation blocks future requests but cannot retract downloaded bytes or cached local drafts. Static tokens and a local key file do not constitute a production identity/key system.

Every artifact in a static build is public. A Pages success says nothing about server persistence, upload resume, or authorization. Browser storage is subject to origin/profile isolation and eviction; it is not a backup of the server.

## Evidence and revisit trigger

[IdentityFilter](../../backend/src/main/java/dev/commonplace/IdentityFilter.java), [Catalog](../../backend/src/main/java/dev/commonplace/Catalog.java), and [Lifecycle](../../backend/src/main/java/dev/commonplace/Lifecycle.java) enforce the boundary; [FoundationTest](../../backend/src/test/java/dev/commonplace/FoundationTest.java) and [SyncTest](../../backend/src/test/java/dev/commonplace/SyncTest.java) cover access denial and revocation. Inspect [the Pages browser test](../../frontend/tests/pages.spec.ts) separately for public sample behavior.

Revisit when the app leaves the loopback trust boundary, an actual identity lifecycle is required, or users need mixed permissions inside a namespace. Define inheritance, token/key lifecycle, auditing, and download behavior before expanding UI controls.
