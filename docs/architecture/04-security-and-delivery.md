# 4. Security and delivery boundaries

## Implemented local trust model

Three configured bearer tokens map to the teaching identities Alice, Bob and Eve. The public defaults are convenient credentials, not a secure login system. The server binds `127.0.0.1`. Set all tokens to independent random values before changing that boundary. Do not expose the local server to the internet; it lacks TLS termination, account enrollment, rate limits and a managed key service. It has no Google dependency.

The [identity filter](../../backend/src/main/java/dev/commonplace/IdentityFilter.java) applies to every API route except health. Tokens travel in the Authorization header, never download URLs. Responses are `no-store`; CORS is not enabled. Browser-origin requests cannot use ambient cookie credentials because there are none. JSON reads are bounded, and block requests have a separate bound. Content downloads use `application/octet-stream`, `Content-Disposition: attachment` and `nosniff`; user HTML/SVG does not execute as the application origin.

Namespace membership is the authorization boundary. Owners manage sharing and permanent purge; writers mutate content and folders; readers list and download. Sharing is namespace-wide, not individual files or inherited per-folder ACLs. [Catalog](../../backend/src/main/java/dev/commonplace/Catalog.java) enforces it server-side, including before returning cached idempotency results. Upload sessions additionally belong to their initiating user. An owner cannot inspect another user's pending session through its ID.

Payloads are AES-GCM encrypted before persistence. Namespace/hash authenticated data detects relocation or corruption. The key is kept outside the database and created with owner-only POSIX permissions where supported. Metadata, names, sizes and membership are plaintext; the OS account and database remain trusted. Encryption at rest does not protect a compromised running server. No compression, cross-namespace deduplication, malware scanner or end-to-end key management is implemented.

## Honest delivery modes

The full local application owns persistent metadata, encrypted blocks, resumable uploads, access enforcement, notifications and browser synchronization. A later React static build will contain only explicitly authored public sample content. GitHub Pages cannot run Spring, H2 or a scheduler. Static mode must offer browsing, search, sample downloads and revision inspection while directing state-changing workflows to the local application.

## Decision record: authorization scope

Requirement → understandable, testable sharing. Mechanism → one membership table per namespace, role checks on every API. Tradeoff → no item-level permission exceptions. Evidence → HTTP integration tests deny reader writes and revoked reads. Revisit → users need mixed private/public subtrees inside one namespace; introduce explicit inheritance rules and evaluate every query/download against them before changing UI controls.
