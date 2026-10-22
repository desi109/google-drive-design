# 1. Requirements and capacity

## Design inputs, not measured traffic

The reference assumes 50 million registered accounts, 10 million daily active users, two 500 KB uploads per active user per day, a 1:1 download/upload ratio, and a 2× peak factor. We define KB = 1,000 bytes, GB = 1,000,000,000 bytes and PB = 10^15 bytes. MiB = 1,048,576 bytes. The maximum file size and initial namespace quota are both 10,000,000,000 bytes (about 9.313 GiB).

- Allocated entitlement: 50,000,000 × 10 GB = **500 PB**. This is a quota promise, not evidence of 500 PB physically stored.
- Uploads/day: 10,000,000 × 2 = **20 million**.
- Average upload initiation rate: 20,000,000 / 86,400 = **231.48/s**; 2× peak = **462.96/s**. The reference's 240/480 are coarse rounding.
- Incoming logical bytes/day: 20,000,000 × 500,000 = **10 TB/day**, or **115.74 MB/s** average, **231.48 MB/s** peak.
- With a 1:1 read/write ratio, nominal download payload is another 10 TB/day. Metadata calls, manifests, retries, revisions, encryption overhead and replication add traffic/storage.
- Annual new-upload input, assuming no deletion: 10 TB × 365 = **3.65 PB**. This excludes initial occupancy and extra revisions. Physical storage requires measured reuse/compression, retention and replica factors; neither the reference nor this lab establishes them.
- A maximum file has ceil(10,000,000,000 / 4,194,304) = **2,385** blocks. Last block: **779,264 bytes**. (Check this arithmetic in the runnable capacity lab.)

## User journeys and ownership

A namespace owner creates folders, uploads any file type, renames/moves entries, inspects/downloads revisions, shares a namespace as reader or writer, and trashes/restores/purges entries. Writers can change files, readers can browse and download. Sharing is namespace-wide to keep inheritance unambiguous. Each browser maintains its own cached metadata, pending edit queue and cursor. Collaborative document editing, native filesystem watching, mobile push and Google identity are excluded.

## Non-negotiable invariants

Stable UUIDs identify entries independently of paths. A folder move cannot cross namespaces or form a cycle. Visible content always references a complete immutable revision. Namespace-scoped SHA-256 block keys never enable cross-namespace reuse. An accepted stale edit creates a separate conflict copy and leaves the newer head intact. Revision manifests and payloads are immutable until an explicit retention/purge action removes them. An active upload and all retained revisions keep their blocks reachable. Quota charges retained revision logical bytes, including conflict copies; storage reuse does not expand entitlement.

## Consistency and performance

One JVM serializes domain transactions. H2 owns durable metadata and encrypted block payloads, avoiding a database/filesystem dual-write gap. This favors an inspectable lab over upload parallelism. A future production system needs partitioned namespace transactions and object storage.

Proposed production SLOs: 99.9% monthly metadata availability, p95 metadata reads <200 ms, and p95 online change visibility <2 s under a defined regional workload. These are goals, not measured lab results. Offline browsers necessarily show stale snapshots; strong metadata transactions cannot make disconnected displays identical.

## Critical reading

The reference's path identifiers break under rename; use stable IDs. ACID alone does not choose an isolation level or solve concurrent head updates. Cache invalidation alone is not proof of linearizability. Object storage is not automatically cross-region replicated; configure and test replication and recovery. S3 currently provides strong read-after-write consistency ([AWS documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html#ConsistencyModel)); old eventual-consistency assumptions need revision. Block hashing/reuse is not the rsync algorithm, and fixed-size boundaries perform poorly after insertions. This implementation will not claim compression or content-defined chunking.

## Design review

Which quota promise is honest if old revisions consume space? What happens if two devices rename one file offline? How would you bound reconnect time after six months away? At what measured lock wait would you split block transport from metadata?
