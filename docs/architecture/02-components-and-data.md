# 2. Components and authoritative data

The [schema](../../backend/src/main/resources/schema.sql) is installed idempotently at startup. JDBC is used directly so the transaction boundary and queries stay visible. [Database.tx](../../backend/src/main/java/dev/commonplace/Database.java) holds one JVM monitor around the full transaction, including commit. [Catalog](../../backend/src/main/java/dev/commonplace/Catalog.java) owns namespace access, folder topology and optimistic metadata versions. [IdentityFilter](../../backend/src/main/java/dev/commonplace/IdentityFilter.java) resolves bearer tokens before API execution.

```mermaid
flowchart LR
  Browser[Browser client] --> API[Spring HTTP API]
  API --> Catalog[Catalog and permissions]
  Catalog --> DB[(H2 persistent database)]
```

Namespaces own entries and members through database foreign keys. `members(ns,user_id)` is unique and roles have a database CHECK constraint. Entry IDs are primary keys. `entries(ns,parent_id,deleted)` accelerates folder reads. Parent relationships are checked by the application, not a foreign key: the empty string denotes a namespace root. Cycle, sibling-name and cross-namespace validation depend on the single transaction serializer. Moving to several processes without replacing that mechanism would be incorrect.

`operations(actor,op_key)` stores a canonical request digest and response in the same transaction as each retryable mutation. A different request using an old key yields `409 KEY_REUSED`. The application retains these receipts indefinitely in this lab; production needs a documented retry horizon before pruning them. Access is rechecked before namespace-scoped replay.

The [foundation test](../../backend/src/test/java/dev/commonplace/FoundationTest.java) checks unauthenticated access, denied namespace reads, stable IDs, idempotent folder creation, request mismatch and folder cycles.

Architectural lesson: make a small workflow correct and persistent before extracting services. A low component count is useful when it makes the ownership and consistency boundary clear.
