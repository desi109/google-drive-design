# File storage, from requirements to architectural judgment

This workshop is for mid-level and senior developers who can implement an endpoint and want to reason about the system around it. Commonplace turns a Drive-style design into an inspectable Java 21 / Spring Boot 3.5.16 application: JDBC, H2, encrypted blocks, and a React / TypeScript browser client. Its one-process consistency boundary is a deliberate teaching choice. A service diagram is useful only after the ownership, failure behavior, and operational costs are clear.

Read the chapters in order, then use the labs to challenge their claims:

1. [Requirements and capacity](architecture/01-requirements-and-capacity.md) — turn product language into units, invariants, and a workload.
2. [Components and data](architecture/02-components-and-data.md) — identify authoritative state and separate SQL constraints from application rules.
3. [Workflows and consistency](architecture/03-core-workflows-and-consistency.md) — trace interruption, retries, stale edits, retention, and collection.
4. [Security and delivery](architecture/04-security-and-delivery.md) — follow credentials, permissions, encryption, and public sample content across trust boundaries.
5. [Scaling and operations](architecture/05-scaling-and-operations.md) — recognize the first bottleneck, propose a migration, and make recovery testable.
6. [Build and architecture labs](architecture/06-build-and-architecture-labs.md) — run contract experiments, a restart/restore drill, and architecture exercises.

The [decision records](decisions/0001-local-transaction-boundary.md) capture alternatives and consequences. Each chapter distinguishes **implemented behavior**, **evidence in source/tests**, and **proposed production work**. Capacity estimates and SLOs are design inputs; they are not performance measurements.

## What the workshop should let you explain

| Requirement | Implemented mechanism | Cost to defend | Evidence | Revisit when |
| --- | --- | --- | --- | --- |
| Rename/move without losing file identity | UUID entries; paths derived from parents | Topology checks run inside transactions | [Catalog](../backend/src/main/java/dev/commonplace/Catalog.java), [FoundationTest](../backend/src/test/java/dev/commonplace/FoundationTest.java) | Several writers/processes must enforce these rules |
| Resume an interrupted upload | Immutable manifest, session, accepted part indexes | Reservations and abandoned sessions require lifecycle policy | [Transfers](../backend/src/main/java/dev/commonplace/Transfers.java), [TransferTest](../backend/src/test/java/dev/commonplace/TransferTest.java) | Transfer traffic blocks metadata work |
| Preserve stale edits | Observed version; new conflict file for stale content | People must resolve conflicts; metadata edits still reject staleness | [Transfers.complete](../backend/src/main/java/dev/commonplace/Transfers.java), [TransferTest](../backend/src/test/java/dev/commonplace/TransferTest.java) | The product requires concurrent in-document editing |
| Recover after disconnect | Transactional change rows, cursor snapshot, polling hints | Feed and retry receipts grow indefinitely here | [Events](../backend/src/main/java/dev/commonplace/Events.java), [SyncTest](../backend/src/test/java/dev/commonplace/SyncTest.java) | Retention requires cursor expiry and full resync |
| Enforce sharing | Namespace role checks on server requests | No file/folder permission exceptions | [Catalog](../backend/src/main/java/dev/commonplace/Catalog.java), [Lifecycle](../backend/src/main/java/dev/commonplace/Lifecycle.java) | Mixed access inside one namespace becomes a requirement |
| Remove bytes safely | Trash, explicit purge, reference-checked block GC | Space is reclaimed later; tombstones remain | [Lifecycle](../backend/src/main/java/dev/commonplace/Lifecycle.java), [SyncTest](../backend/src/test/java/dev/commonplace/SyncTest.java) | Object storage or multiple collectors introduces races |

## Scope and evidence

The local application stores metadata and AES-GCM ciphertext in the same H2 database. It supports namespace-wide sharing, resumable block transfers, immutable revisions, change polling, and explicit lifecycle actions. Browser synchronization means cached metadata and a saved outbox for browser text drafts; a large upload resumes after the user reselects the original file. It does not watch native folders, synchronize an operating-system filesystem, merge collaborative text operations, or call Google APIs.

The full browser and public static sample are separate delivery modes. Pages can demonstrate authored sample browsing and downloads; it cannot run this backend or enforce private namespace access. Verify browser acceptance separately with the frontend checks described in the labs. Backend integration tests are evidence for HTTP/domain behavior, not proof of a browser reconnect journey or of 10 GB throughput.

## Using the reference critically

The [Design Google Drive reference](https://github.com/desi109/cheat-sheets/blob/master/system-design/16-design-Google-Drive.md) supplies the initial workload and topics: blocks, versions, namespaces, synchronization, and a distributed component sketch. This workshop writes its own diagrams and examples around this repository. It changes path identity to stable IDs, makes transaction boundaries explicit, preserves stale writes as visible conflict copies, and distinguishes logical quota from stored bytes. Reference illustrations are not redistributed.

For each architecture discussion, ask: **Which invariant is at risk, what state proves it, what can fail between steps, and what new mechanism replaces our current guarantee?** A proposed service extraction is incomplete until it answers all four.
