# Commonplace — a file storage architecture lab

A working Google Drive-style file storage and **browser synchronization** platform, paired with an architecture workshop for mid-level and senior developers. Follow real transactions, interrupted transfers, concurrent edits, permissions, and recovery instead of stopping at a service diagram.

**[Live public sample](https://desi109.github.io/google-drive-design/)** · [Source repository](https://github.com/desi109/google-drive-design)

The sample supports folder navigation, search, downloads, and revision inspection. Uploads, synchronization, encrypted storage, and permission enforcement run in the full local application.

## Quick start

```bash
cd /path/to/google-drive-design
npm start
```

Open **http://127.0.0.1:8080**. Prerequisites: **JDK 21**, **Node.js 22.12 or newer**, and npm. The launcher discovers Java 21 through Gradle, installs locked frontend dependencies, builds the UI and executable JAR, and starts one process serving both UI and API. First-run dependency downloads take longer and require internet access. Later starts rebuild as needed and **preserve existing data**. Stop with Ctrl+C.

If port 8080 is occupied, use `PORT=8081 npm start`; the launcher never stops another application. `./start.sh` is an equivalent entry point. If Java 21 is not discovered, set `JAVA_HOME` to your JDK 21 installation and inspect `./backend/gradlew -p backend javaToolchains`.

Start learning at the [architecture workshop](docs/architecture.md), or run the [hands-on labs](docs/architecture/06-build-and-architecture-labs.md).

## What works

- Namespaces and folders, with stable file IDs across renames and moves, topology checks and optimistic metadata versions.
- Resumable uploads using fixed **4 MiB** blocks, SHA-256 validation, accepted-part discovery, safe retries and namespace-scoped reuse.
- AES-256-GCM encrypted block payloads in persistent H2 storage, streamed downloads, and immutable revisions.
- Namespace-wide owner/writer/reader permissions, checked by the backend on every request; local Alice, Bob and Eve identities.
- Durable paginated changes feed, polling notification hints, and atomic snapshots with cursors.
- Browser metadata caching and an IndexedDB outbox for offline text drafts. Stale content writes become separate conflict copies; the current file is preserved.
- Trash and restore, owner-only permanent content purge, retained metadata tombstones, and bounded reference-safe garbage collection.
- Original sample content seeded once, including a file with two revisions. Set `DRIVE_SEED=false` for a blank library.

### Try two independent clients

Use two browser profiles or isolated browser contexts, both as Alice. Inspect `Welcome.txt` and open **Edit text** in each. Disconnect one client (its **Go offline** control pauses requests, or use actual browser network-offline mode), save an offline draft, then save a different revision in the connected client. Reconnect the first. Its draft becomes a named conflict copy; both contents remain downloadable. **Activity** shows changes discovered while that client runs.

Text drafts up to 1 MiB persist in IndexedDB with the observed version and retry key. A failed or revoked draft remains exportable/discardable and does not block valid drafts in another namespace. Clearing browser site data or browser eviction can remove local drafts; export important unsynchronized work. The application shell is not a service-worker offline installation: load it online before disconnecting. Cached metadata is stale until reconnect.

For large file uploads, the browser reads/hashes one slice at a time. After reload or interruption, select the same file again; its manifest must match before missing parts resume. The browser does **not** watch native directories or synchronize the operating-system filesystem. Collaborative document editing is excluded. No Google Drive APIs, Google OAuth, paid services, or cloud account is required.

## Limits, byte units, and evidence

**GB = 1,000,000,000 bytes; MiB = 1,048,576 bytes.** Maximum file size and initial namespace quota are 10,000,000,000 bytes (about 9.313 GiB). A maximum file has 2,385 parts; its last part is 779,264 bytes.

Quota charges logical bytes of **all retained revisions**, including trash and conflict copies, plus active upload reservations. Reusing a stored block saves physical bytes but does not increase quota. The UI's encrypted-block total includes AES-GCM overhead and temporary/uncollected blocks; it excludes H2 file/index/log overhead. The reference's 500 PB is allocated entitlement, not measured physical storage.

Experimentally verified:

- Real ordered upload/download of **8,388,631 bytes** (two full blocks plus 23-byte tail), using 8 KiB streaming reads in the HTTP test.
- A 4,194,305-byte block is rejected with 413. A 10,000,000,001-byte file declaration is rejected with 413.
- An exact 10 GB manifest/reservation is accepted with 2,385 hashes and **zero payload blocks allocated**. A full 10 GB payload transfer and its memory/throughput profile have **not** been measured.
- Concurrent completion preserves one current head and one conflict copy. Restart tests reopen the real file-backed database and matching encryption key.

The API downloads one authenticated block at a time. The browser buffers downloads only up to 64 MiB; larger downloads require desktop Chromium's File System Access API or the streaming HTTP API with `curl`. The save picker opens before awaiting network headers. Previews/edit reads and fallback downloads are bounded and pinned to the selected immutable revision.

## Local security and persistence

The server binds loopback by default. Default teaching credentials are public: `local-alice-key`, `local-bob-key`, `local-eve-key`. **Account settings** selects the local identity/token. Bob initially has reader access to the seeded studio; Alice can change it through **Share**. These are independent learning identities, not an account-registration system.

Keep this application local. It does not supply internet-facing TLS, login enrollment, rate limiting, malware scanning, managed keys, high availability or distributed coordination. Encryption covers server-stored payloads; names/metadata and browser drafts are plaintext. It is server-side encryption, not end-to-end encryption.

Root startup stores `metadata.mv.db` and `block-key.bin` under **`./data`**. Both are excluded from Git. Losing the key makes ciphertext unreadable; startup refuses to silently replace a missing key when blocks exist. Back up the database **and matching key together after stopping the application**. Do not copy a live H2 file as if it were a consistent backup. See the [backup/restore runbook](docs/architecture/05-scaling-and-operations.md#backup-restore-rpo-and-rto) and [executable restore lab](docs/architecture/06-build-and-architecture-labs.md#lab-3-restart-and-restore-are-different-failures).

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listen port |
| `HOST` | `127.0.0.1` | Bind address; keep the teaching server local |
| `DRIVE_DATA` | repository `./data` | Persistent database and key directory; relative paths resolve at the repository root |
| `DRIVE_SEED` | `true` | Seed original samples once; `false` skips seeding without deleting data |
| `ALICE_TOKEN` | `local-alice-key` | Alice bearer token |
| `BOB_TOKEN` | `local-bob-key` | Bob bearer token |
| `EVE_TOKEN` | `local-eve-key` | Eve bearer token |
| `JAVA_HOME` | JDK discovery | Java installation used to start Gradle; its toolchain selects JDK 21 |

Tokens must be distinct and at least 12 characters. Spring Boot configuration/environment overrides remain available. Direct `bootRun` from `backend` uses that working directory's `./data`; use root `npm start` or explicitly set an absolute `DRIVE_DATA` to avoid opening the wrong library.

## Development and verification

Pinned build: Java 21, Spring Boot 3.5.16, checksum-verified Gradle 8.14.3, React 19.3.1, TypeScript 5.9.3, Vite 7.3.7, Playwright 1.61.1. Gradle dependency locks and npm lockfiles are committed. Compatibility was checked against [Spring requirements](https://docs.spring.io/spring-boot/3.5/system-requirements.html), [Gradle's Java matrix](https://docs.gradle.org/8.14.3/userguide/compatibility.html) and [Vite requirements](https://vite.dev/guide/). Local verification used Java 21.0.11 selected through Gradle with Node 24.2.0; CI uses Java 21 and Node 22.12.0.

```bash
# Tests and packaged application
npm test                          # launcher configuration and port ownership
npm run test:backend               # real HTTP and file-backed integration tests
npm run build                     # local frontend + executable Spring Boot JAR
npm exec --prefix frontend -- playwright install chromium
npm run test:local                 # seven browser journeys; isolated port and disposable data
npm run build:pages                # separate public-sample output
npm run test:pages                 # sample browsing/search/download/revisions/reload/mobile
npm run test:docs                  # local links and browser-rendered Mermaid diagrams
```

Current evidence: 20 backend tests, 4 startup tests, 7 local browser tests and 1 Pages journey pass. The docs check renders 9 Mermaid diagrams. The architecture API, stop/start and cold-restore labs were also executed using disposable data. Tests demonstrate the single-process behavior; they do not establish production SLOs, power-loss durability, distributed correctness, or 10 GB throughput.

For hot reload, run `cd backend && ./gradlew bootRun` and, in another terminal, `cd frontend && npm ci && npm run dev`. Open http://127.0.0.1:5173; Vite proxies `/api` to localhost 8080. For a packaged launch after `npm run build`, use JDK 21:

```bash
DRIVE_DATA="$PWD/data" java -jar backend/build/libs/commonplace-1.0.0.jar
```

`./backend/gradlew -p backend bootJar` also installs/builds the local frontend. The Pages build writes `frontend/dist-pages`; it cannot replace the local `frontend/dist` packaged in the JAR. Backend API examples and structured error contracts are in [chapter 3](docs/architecture/03-core-workflows-and-consistency.md#runnable-contract). Health is `/api/health`.

## Architecture workshop

| Chapter | What it teaches |
| --- | --- |
| [Workshop entry point](docs/architecture.md) | Audience, reading order, traceability and evidence |
| [1. Requirements and capacity](docs/architecture/01-requirements-and-capacity.md) | Recalculated workload, byte units, quota, invariants and exclusions |
| [2. Components and data](docs/architecture/02-components-and-data.md) | Authoritative ownership, ER model, SQL constraints and application rules |
| [3. Workflows and consistency](docs/architecture/03-core-workflows-and-consistency.md) | Transactions, resume, retries, conflicts, cursors, retention and GC |
| [4. Security and delivery](docs/architecture/04-security-and-delivery.md) | Identity, permission checks, encryption and static/local trust boundaries |
| [5. Scaling and operations](docs/architecture/05-scaling-and-operations.md) | Proposed service extraction, SLOs, observability, recovery and runbooks |
| [6. Build and architecture labs](docs/architecture/06-build-and-architecture-labs.md) | Runnable contract/restart/restore experiments and design-review exercises |
| [Decision records](docs/decisions/0001-local-transaction-boundary.md) | Alternatives, consequences, evidence and revisit triggers |

The [original reference](https://github.com/desi109/cheat-sheets/blob/master/system-design/16-design-Google-Drive.md) supplies the starting workload and topics. This project uses original explanations, diagrams and samples, corrects oversimplified claims, and separates implemented mechanisms from proposed production architecture. Start with a modular monolith; split it only when measurements show which invariant-preserving mechanism must replace the current boundary.

## Read the implementation history

Use `git log --reverse --format='%h %s'` and inspect each numbered commit with `git show <hash>`. Each step carries its own dependencies and verification appropriate to that stage:

1. Define storage invariants and capacity assumptions.
2. Establish the persistent catalog and access boundary.
3. Implement encrypted resumable uploads and immutable revisions.
4. Add durable synchronization events and safe data lifecycle.
5. Verify concurrent writes and persistent recovery.
6. Build the browser client and reconnect workflows.
7. Package one-command startup and complete the architecture workshop.
8. Publish and verify the GitHub Pages sample.

Early commits are API-first and explain how to run their stage; later commits add the UI and root launcher. Proposed production components never become prerequisites for running this lab.

## GitHub Pages

The [Pages workflow](.github/workflows/pages.yml) uses the actual `main` branch, immutable official Action pins, `npm ci`, an explicit public-sample build, and browser verification before uploading **only `frontend/dist-pages`**. Pages uses `/google-drive-design/` as its base; hash-based folder navigation survives direct links and reloads. The [verification workflow](.github/workflows/ci.yml) additionally runs backend, launcher, packaged-local browser, and documentation checks.

Pages hosts authored public samples. It does not run Java, H2, upload sessions, server-enforced permissions, background cleanup, or synchronization between visitors. No runtime database or private uploads are exported to the sample. The HTTPS deployment was verified in Chromium at the public URL, including folder navigation, search, a historical-revision download, direct-link reload and phone layout. Publication is checked separately from a successful static build.
