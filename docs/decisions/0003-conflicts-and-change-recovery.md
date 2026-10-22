# ADR 0003: preserve stale edits and recover through durable state

Status: accepted for the local workshop.

## Requirement and context

An offline browser can edit a version that is no longer current. Networks can lose replies and notifications. The system must preserve accepted user bytes and let clients determine authoritative state after reconnect.

## Decision

Give each entry one monotonically incremented metadata version. Clients send the observed version for metadata changes and upload replacement. Stale metadata mutations reject with `STALE_VERSION`; a stale content completion publishes its immutable revision as a new visibly named conflict file. It does not replace the newer original head. A deletion or name race also preserves the completed upload.

Append changes in the same transaction as visible mutations. Expose ordered pages and a coherent snapshot/cursor. Notifications are polling hints. Mutation receipts and terminal upload results resolve ambiguous replies. Browser draft jobs preserve the original key and observed version; large files resume after reselection rather than assuming permanent filesystem access.

## Alternatives considered

| Alternative | Tradeoff |
| --- | --- |
| Last-writer-wins by arrival/time | Simpler UI but silently loses another accepted edit; device clocks do not express causality |
| Reject stale content entirely | Prevents overwriting but forces users to recover bytes outside the publication flow |
| OT/CRDT collaborative editing | Useful for format-specific concurrent editing, with a different data model and conflict contract; outside arbitrary-file storage scope |
| WebSocket-only change delivery | Low latency while connected, but a disconnect requires a durable checkpoint/history source anyway |
| Complete event-sourced catalog | Enables historical reconstruction but adds event schema/versioning and projection requirements; current events are invalidation records |

## Consequences and tradeoff

Both edits survive and the user can inspect them. A rename increments the same counter and may conservatively conflict with a content edit. A visible conflict requires human resolution; no semantic merge is claimed. A namespace feed can recover after missed hints, while full snapshots are expensive for large namespaces.

Receipts, changes, upload manifests, and tombstones are retained indefinitely locally. Production needs bounded horizons, cursor expiry, and retry semantics. `CURSOR_AHEAD` detects a high browser cursor after rollback, but a recovery epoch is needed to distinguish every restored history. A server restore cannot recover a post-backup acknowledgment without another durable copy or the client's saved intent.

## Evidence and revisit trigger

[Catalog](../../backend/src/main/java/dev/commonplace/Catalog.java), [Transfers.complete](../../backend/src/main/java/dev/commonplace/Transfers.java), and [Events](../../backend/src/main/java/dev/commonplace/Events.java) show version/replay/feed behavior. [TransferTest](../../backend/src/test/java/dev/commonplace/TransferTest.java) checks two stale edits; [SyncTest](../../backend/src/test/java/dev/commonplace/SyncTest.java) checks feed/access/retention cases. [The labs](../architecture/06-build-and-architecture-labs.md) add restart, restore, and independent-browser exercises.

Revisit when users require simultaneous in-document editing, conflicts become a measured usability issue, snapshot size dominates catch-up, or history must be pruned. A new hint transport alone should not change the recovery contract.
