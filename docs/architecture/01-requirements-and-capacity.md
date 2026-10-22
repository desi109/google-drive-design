# 1. Requirements and capacity

## Design inputs, not measured traffic

The reference assumes 50 million registered accounts, 10 million daily active users, two 500 KB uploads per active user per day, a 1:1 download/upload ratio, and a 2× peak factor. Treat those as a hypothetical planning scenario, not Commonplace telemetry. We define KB = 1,000 bytes, GB = 1,000,000,000 bytes and PB = 10^15 bytes. MiB = 1,048,576 bytes. The maximum file size and initial namespace quota are both 10,000,000,000 bytes (about 9.313 GiB).

- Allocated entitlement: 50,000,000 × 10 GB = **500 PB**. This is a quota promise, not evidence of 500 PB physically stored.
- Uploads/day: 10,000,000 × 2 = **20 million**.
- Average upload initiation rate: 20,000,000 / 86,400 = **231.48/s**; 2× peak = **462.96/s**. The reference's 240/480 are coarse rounding.
- Incoming logical bytes/day: 20,000,000 × 500,000 = **10 TB/day**, or **115.74 MB/s** average, **231.48 MB/s** peak.
- With a 1:1 read/write ratio, nominal download payload is another 10 TB/day. Metadata calls, manifests, retries, revisions, encryption overhead and replication add traffic/storage.
- Annual new-upload input, assuming no deletion: 10 TB × 365 = **3.65 PB**. This excludes initial occupancy and extra revisions. Physical storage requires measured reuse/compression, retention and replica factors; neither the reference nor this lab establishes them.
- A maximum file has ceil(10,000,000,000 / 4,194,304) = **2,385** blocks. Last block: **779,264 bytes**. (Check this arithmetic in the runnable capacity lab.)

A file of the stated mean size, 500 KB, fits in one block. A mean alone does not establish the average number of parts: a workload with many tiny files and a few large files can have that same mean and a different block-request rate. It also does not justify modeling every upload as 2,385 requests. Conversely, an average hides the tail: a few large files can dominate bandwidth and time spent in a download transaction. Capture a size histogram, revision frequency, and session abandonment before sizing production storage.

For planning, define `L` as retained logical bytes, `d` as the fraction remaining after namespace-scoped block reuse, `N` as distinct retained blocks, and `r` as total replica factor. A retained-payload estimate is `(L × d + 28 × N) × r`. Budget temporary upload bytes and uncollected blocks separately, then add manifests, indexes, logs, snapshots, backups, and operating headroom. The lab reports `storedBytes` as block plaintext lengths plus AES-GCM overhead for all stored blocks, including temporary/uncollected ones; it is **not** H2 file size, allocated disk, or a deduplication benchmark. A reuse factor must come from the intended workload.

## Translate product language into acceptance tests

| Product statement | Precise contract | Boundary case |
| --- | --- | --- |
| “Up to 10 GB” | Each revision is at most 10,000,000,000 bytes | 10,000,000,001 is rejected before accepting parts |
| “10 GB of storage” | Retained revision logical bytes + live upload reservations fit namespace quota | Reuploading identical bytes still consumes logical quota |
| “Resume” | Ask the same authorized session which manifest indexes are accepted | A lost completion reply must return the same publication result |
| “Sync” | A connected browser can discover durable changes and preserve a stale content edit | A disconnected browser has an old snapshot; it cannot know the current head |
| “Delete” | Trash retains revisions; owner-only purge removes revision references | A shared block or active upload must survive collection |
| “Share” | One role per user per namespace | Revocation affects future server requests, not copies already downloaded |

## User journeys and ownership

A namespace owner creates folders, uploads any file type, renames/moves entries, inspects/downloads revisions, shares a namespace as reader or writer, and trashes/restores/purges entries. Writers can change files and trash/restore; only owners share or permanently purge. Readers browse and download. Sharing is namespace-wide to keep inheritance unambiguous. The browser design maintains a cached snapshot/cursor and pending text edits in IndexedDB. A file picker does not grant durable access to arbitrary local files, so interrupted large-file uploads require reselection. Collaborative document editing, native filesystem watching, mobile push and Google identity are excluded.

## Non-negotiable invariants

Stable UUIDs identify entries independently of paths. A folder move cannot cross namespaces or form a cycle. Visible content always references a complete immutable revision. Namespace-scoped SHA-256 block keys never enable cross-namespace reuse. An accepted stale edit creates a separate conflict copy and leaves the newer head intact. Revision manifests and payloads are immutable until an explicit retention/purge action removes them. An active upload and all retained revisions keep their blocks reachable. Quota charges retained revision logical bytes, including conflict copies; storage reuse does not expand entitlement.

## Consistency and performance

One JVM serializes domain transactions. H2 owns durable metadata and encrypted block payloads, avoiding a database/filesystem dual-write gap. This favors an inspectable lab over upload parallelism. A future production system needs partitioned namespace transactions and object storage.

Proposed production SLOs: 99.9% monthly metadata availability, p95 metadata reads <200 ms, and p95 online change visibility <2 s under a defined regional workload. These are goals, not measured lab results. [Operations](05-scaling-and-operations.md) defines their denominator, exclusions, and measurement points. Offline browsers necessarily show stale snapshots; strong metadata transactions cannot make disconnected displays identical.

## Critical reading

The reference's path identifiers break under rename; use stable IDs. ACID alone does not choose an isolation level or solve concurrent head updates. Cache invalidation alone is not proof of linearizability. A future object store needs an explicit durability, consistency, replication, and recovery contract; a provider name does not specify them. Block hashing/reuse is not the rsync algorithm, and fixed-size boundaries perform poorly after insertions. This implementation does not perform compression or content-defined chunking. The [capacity and chunking lab](06-build-and-architecture-labs.md) makes that limitation visible with a small deterministic example.

## Keep requirements separate from solutions

“Never lose an acknowledged revision” is a durability requirement. “Use a queue” is a mechanism proposal and introduces another durable boundary to defend. “Make all reads linearizable” is too broad until the read is named: authoritative metadata reads are serialized here; an offline cached view is intentionally stale. “Support 50 million accounts” is a sizing exercise, not a local acceptance test. Review the solution against concrete user-visible failure behavior before selecting infrastructure.

## Design review

Which quota promise is honest if old revisions consume space? What happens if two devices rename one file offline? How would you bound reconnect time after six months away? At what measured lock wait would you split block transport from metadata?
