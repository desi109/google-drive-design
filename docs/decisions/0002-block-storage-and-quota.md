# ADR 0002: fixed namespace blocks and logical retained quota

Status: accepted for the local workshop.

## Requirement and context

Transfers must resume without buffering a whole large file, preserve immutable revisions, and share unchanged bytes safely. A declared 10 GB entitlement must have a meaning independent of whether a particular file happens to deduplicate well.

## Decision

Split bytes at fixed 4 MiB boundaries; address each part with lowercase SHA-256. Scope block uniqueness to `(namespace, hash)`. Verify declared size/hash before accepting a part. Encrypt distinct blocks with AES-256-GCM using a random 12-byte nonce and namespace/hash authenticated data, then store ciphertext in H2. Keep an expected upload manifest separate from accepted part references.

Charge logical bytes for every retained revision plus every unexpired open upload reservation. Complete converts a reservation to revision usage; cancel/expiry releases reservation. Purge removes retained usage. Namespace maximum entitlement and per-file limit are both 10,000,000,000 decimal bytes.

## Alternatives considered

| Alternative | Tradeoff |
| --- | --- |
| Whole-file object per revision | Simpler manifest, but resumed/repeated transfers cannot reuse individual unchanged ranges |
| Content-defined chunking | Better reuse after insertions, with more boundary/computation/parameter complexity and a different client contract |
| Cross-namespace deduplication | Saves more physical bytes but expands the privacy, access, accounting, and garbage-collection boundary |
| Physical-byte quota | Entitlement varies with content/reuse and creates surprising charges when shared references disappear |
| Compression before encryption | Could save bytes for some workloads; requires bounded decompression and an explicit format/integrity contract; not implemented |

## Consequences and tradeoff

Resuming uses missing indexes, not byte offsets inferred from connection progress. The server still authenticates every request; knowing a hash does not grant access. Fixed boundaries are easy to explain and bound, but a front insertion can change all following blocks. A file can consume quota despite reusing every block. Trash and old revisions continue consuming quota until explicit purge.

Each distinct encrypted block adds 28 bytes of nonce/tag overhead before database overhead. Metadata remains plaintext, and a running server with the local key can decrypt. Lost key material makes otherwise healthy ciphertext unreadable. This is server-side encryption, not end-to-end encryption or a production key lifecycle.

## Evidence and revisit trigger

[Transfers](../../backend/src/main/java/dev/commonplace/Transfers.java) implements size/manifest/reservation rules; [BlockCipher](../../backend/src/main/java/dev/commonplace/BlockCipher.java) implements the format. [TransferTest](../../backend/src/test/java/dev/commonplace/TransferTest.java) checks incorrect parts, same-namespace reuse, cross-namespace nonreuse, encryption persistence, quota reservation, and completion retries. The [capacity lab](../architecture/06-build-and-architecture-labs.md) illustrates insertion effects without claiming a measured deduplication ratio.

Revisit block sizing/chunking after measuring size and edit distributions, client hashing cost, manifest overhead, and actual reuse. Revisit quota only with a product-level migration policy for existing retained data. Revisit encryption for key rotation, independent key administration, or a requirement that the server cannot read content.
