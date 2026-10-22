# ADR 0001: one local transaction boundary

Status: accepted for the local workshop.

## Requirement and context

An acknowledged publication must expose a complete immutable revision. Retries, quota reservation, name checks, observed versions, and change rows must agree after interruption. The workshop must make the transaction visible to developers without requiring distributed infrastructure.

## Decision

Use Java 21, Spring Boot, direct JDBC, and file-backed H2. Every supported domain read/write enters `Database.tx`, whose synchronized monitor covers the transaction and commit. Store encrypted block payloads in H2 alongside metadata. Keep catalog, transfers, lifecycle, and feed as modules in one application.

## Alternatives considered

| Alternative | Why defer it |
| --- | --- |
| Filesystem payloads plus SQL metadata | Introduces two persistence boundaries and orphan/publication recovery before the core model is established |
| Multiple services and a broker | Requires distributed authorization, ordering, delivery/retry, and deployment mechanisms without improving the local learning contract |
| Production SQL plus per-namespace locks/CAS immediately | A credible next stage, but increases setup and hides less of the race if introduced after the serial baseline |
| In-memory maps | Simple setup but cannot demonstrate durable receipts, restart recovery, or reference integrity |

## Consequences and tradeoff

One transaction can atomically create a revision, install its manifest/head, persist a receipt, and append a change. The code is compact enough to inspect. A global monitor also means slow downloads block unrelated requests and scheduled work. The H2 data file is a single-process deployment boundary; adding a load balancer and another JVM does not preserve application rules. SQL constraints alone do not enforce tree/name/quota invariants.

Startup DDL is sufficient for this evolving lab, not a production migration system. Payload BLOBs make backup atomic with metadata but grow the database and couple transfer throughput to its transaction path.

## Evidence and revisit trigger

[Database](../../backend/src/main/java/dev/commonplace/Database.java), [schema](../../backend/src/main/resources/schema.sql), and [TransferApi](../../backend/src/main/java/dev/commonplace/TransferApi.java) show the boundary, including streaming under the monitor. [FoundationTest](../../backend/src/test/java/dev/commonplace/FoundationTest.java), [TransferTest](../../backend/src/test/java/dev/commonplace/TransferTest.java), and [SyncTest](../../backend/src/test/java/dev/commonplace/SyncTest.java) exercise supported HTTP invariants. They do not establish multi-process correctness or performance capacity.

Revisit when measured lock wait/hold time threatens the agreed latency objective, when more than one application instance is required, or when payload storage/backup size outgrows the local operational model. The replacement must specify database concurrency, object publication, and reader/collector safety before this monitor is removed. See [the proposed production path](../architecture/05-scaling-and-operations.md).
