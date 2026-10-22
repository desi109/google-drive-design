# Commonplace — file storage architecture lab

A Google Drive-style learning application for studying resumable transfers, immutable revisions, permissions, and browser synchronization. Independent of Google APIs and OAuth.

Implementation is being introduced in numbered, independently verified commits. Start with the [architecture workshop](docs/architecture.md) and [requirements](docs/architecture/01-requirements-and-capacity.md).

Reference: [Design Google Drive](https://github.com/desi109/cheat-sheets/blob/master/system-design/16-design-Google-Drive.md). This project reworks the reference into a local modular monolith rather than reproducing its distributed infrastructure.

## This commit: persistent catalog

Prerequisite: a Java 21 JDK (Gradle discovers standard installed JDKs). Run `cd backend && ./gradlew test bootRun`. The API listens at `http://127.0.0.1:8080`; the browser UI arrives in a later numbered commit. Gradle 8.14.3 is checksum pinned; Spring Boot 3.5.16 supports Java 21 and Gradle 8.14.3. Node 24.2.0 is available for the later frontend.

Use `Authorization: Bearer local-alice-key`. Bob and Eve use `local-bob-key` and `local-eve-key`; these are public local teaching credentials. The server binds loopback by default. Set `ALICE_TOKEN`, `BOB_TOKEN`, and `EVE_TOKEN` before using a different trust boundary.

Create a namespace with `POST /api/namespaces` and `{"name":"My files"}`, and a unique `Idempotency-Key` header. Read `/api/namespaces` and `/api/namespaces/{id}/snapshot`. Create folders at `/api/namespaces/{id}/folders`. `PATCH /api/entries/{id}` requires `name`, `parentId` and the observed `version`, plus a new idempotency key. IDs remain stable. Metadata lives in `backend/data` when launched from `backend`; later root startup standardizes the location.

## Resumable transfer API

The application now accepts SHA-256 manifests and resumable 4 MiB blocks. See [the transfer contract and failure model](docs/architecture/03-core-workflows-and-consistency.md). Download responses stream authenticated blocks; stale content edits become conflict copies. Quota includes retained revisions and active reservations. Keep `block-key.bin` with your database backup; it is excluded from Git along with all runtime data.
