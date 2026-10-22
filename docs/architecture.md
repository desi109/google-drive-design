# File storage, from requirements to architectural judgment

For mid-level and senior developers moving from feature delivery to architectural ownership. Follow the numbered commits to see a working vertical slice acquire stronger invariants. The goal is to explain why a mechanism exists, what it costs, and when it should change.

1. [Requirements and capacity](architecture/01-requirements-and-capacity.md): units, workload, invariants, scope.

The implementation will use Java 21, Spring Boot, JDBC/H2, and a React/TypeScript browser client. Blocks will be encrypted before entering persistent storage. A single local process deliberately keeps consistency tractable; distributed coordination is a design exercise, not a local claim.

## Acceptance criteria

- Stable IDs survive renames and moves; folders cannot contain themselves.
- Uploads resume by session and part index. Completion is idempotent, atomic, and refuses missing or incorrect blocks.
- Immutable revisions preserve both sides of stale content edits. Namespaces bound reuse, membership, quota, and changes.
- A durable cursor feed survives restarts; notifications are hints. Reconnect pulls authoritative state and retries saved operations.
- All API operations enforce namespace membership and role. A browser cannot elevate a reader.
- Downloads stream one bounded block at a time. Deletion retains revisions; explicit purge plus reference checks makes garbage collection safe.
- Two independent browser contexts demonstrate offline edits and conflict preservation.
- Static Pages supports public sample browsing, search, downloads and revision inspection, with its boundary clearly stated.

## Reference review

The complete source chapter and its diagrams were inspected from the local cheat-sheets checkout after the raw web fetch failed. The reference's file/version/block schema, upload/download sequences, namespace examples, conflict sequence, block/delta diagrams and distributed component diagram inform the workshop. Original project diagrams and explanations are written here; reference images are not redistributed.

2. [Components and data](architecture/02-components-and-data.md): authoritative state and enforced constraints.
