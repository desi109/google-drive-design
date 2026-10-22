# 6. Build and architecture labs

These labs turn architecture claims into observable contracts. They create isolated local data and deliberately exercise rejected requests. They do not benchmark a production service or transfer a 10 GB payload. Python 3's standard library is sufficient for the API experiment; Node, npm, and a Java 21 JDK are needed to launch/build the application.

## Lab 1: validate the capacity model and block tradeoff

Run from the repository root:

```bash
python3 - <<'PY'
from hashlib import sha256
from math import ceil

maximum, block = 10_000_000_000, 4 * 1024 * 1024
count = ceil(maximum / block)
last = maximum - (count - 1) * block
assert (count, last) == (2385, 779264)
uploads = 10_000_000 * 2
print(f"Uploads/s: {uploads / 86400:.2f}; peak: {2 * uploads / 86400:.2f}")
print(f"Input TB/day: {uploads * 500_000 / 10**12:.2f}")
print(f"Maximum-file parts: {count}; last-part bytes: {last}")

# Small boundaries make the insertion effect easy to inspect.
def chunks(data, width=8):
    return [data[i:i + width] for i in range(0, len(data), width)]
def hashes(data):
    return {sha256(part).hexdigest() for part in chunks(data)}
original = b"abcdefghIJKLMNOPqrstuvwxYZ012345"
same_boundary_edit = b"ABCDEFGH" + original[8:]
front_insertion = b"!" + original
assert len(hashes(original) & hashes(same_boundary_edit)) == 3
assert len(hashes(original) & hashes(front_insertion)) == 0
print("Unchanged chunks after first-chunk replacement: 3")
print("Unchanged chunks after front insertion: 0")
PY
```

Explain why the server reuses fixed-size blocks but does not implement rsync or content-defined chunking. Then change the mean file size while preserving a few 10 GB tail files. Which of upload initiation rate, block requests, bandwidth, and transaction hold time can you derive from a mean alone? The answer should identify the missing distribution rather than invent a reuse percentage. See [requirements](01-requirements-and-capacity.md) and [ADR 0002](../decisions/0002-block-storage-and-quota.md).

## Lab 2: start an isolated full application

In terminal A, at the repository root, install/build prerequisites using the [README](../../README.md), then launch:

```bash
export LAB_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/commonplace-workshop.XXXXXX")
printf 'Lab directory: %s\n' "$LAB_ROOT"
HOST=127.0.0.1 PORT=8080 DRIVE_DATA="$LAB_ROOT/live" DRIVE_SEED=false npm start
```

In terminal B, set `LAB_ROOT` to the exact directory printed above. Keep this terminal open for subsequent steps:

```bash
export LAB_ROOT='/replace/with/the/printed/directory'
export DRIVE_URL=http://127.0.0.1:8080
export LAB_RECORD="$LAB_ROOT/receipt.json"
curl -fsS "$DRIVE_URL/api/health"
```

The public local tokens are defaults for this loopback lab. If you configured `ALICE_TOKEN` or `BOB_TOKEN` for the server, export the same values in terminal B. Avoid an existing running instance on port 8080; a successful health check must refer to your isolated instance. Root startup makes the normal data default `./data`; this exercise overrides it so existing work is not modified.

Run the following complete experiment in terminal B. It creates namespaces rather than relying on seed IDs. Assertions are the expected contracts; the command prints a summary only if they hold.

```bash
python3 - <<'PY'
import hashlib, json, os, urllib.error, urllib.request, uuid
from pathlib import Path

base = os.environ.get('DRIVE_URL', 'http://127.0.0.1:8080').rstrip('/') + '/api'
tokens = {'alice': os.environ.get('ALICE_TOKEN', 'local-alice-key'),
          'bob': os.environ.get('BOB_TOKEN', 'local-bob-key')}
block = 4 * 1024 * 1024
key = lambda: str(uuid.uuid4())
digest = lambda data: hashlib.sha256(data).hexdigest()

def call(path, method='GET', body=None, who='alice', idem=None, want=200, raw=False):
    headers = {}
    if who is not None:
        headers['Authorization'] = 'Bearer ' + tokens[who]
    if idem:
        headers['Idempotency-Key'] = idem
    if body is not None:
        is_bytes = isinstance(body, bytes)
        headers['Content-Type'] = 'application/octet-stream' if is_bytes else 'application/json'
        body = body if is_bytes else json.dumps(body).encode()
    request = urllib.request.Request(base + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            status, data = response.status, response.read()
    except urllib.error.HTTPError as response:
        status, data = response.code, response.read()
    assert status == want, (method, path, status, data[:300])
    return data if raw else json.loads(data)

def namespace(name):
    return call('/namespaces', 'POST', {'name': name}, idem=key())['id']

ns = namespace('Workshop ' + key()[:8])
snapshot = lambda: call(f'/namespaces/{ns}/snapshot')
def begin(name, data, file_id=None, version=0, namespace_id=None):
    body = {'ns': namespace_id or ns, 'parentId': '', 'name': name, 'size': len(data),
            'hashes': [digest(data[i:i+block]) for i in range(0, len(data), block)],
            'baseVersion': version}
    if file_id:
        body['fileId'] = file_id
    return call('/uploads', 'POST', body, idem=key())

def finish(session, data):
    session = call('/uploads/' + session['id'])
    for index, offset in enumerate(range(0, len(data), block)):
        if index not in session['parts']:
            call(f"/uploads/{session['id']}/parts/{index}", 'PUT', data[offset:offset+block])
    return call('/uploads/' + session['id'] + '/complete', 'POST', {})

# Stable identity, exact retries, stale metadata, and topology validation.
call('/namespaces', who=None, want=401)
folder_key = key()
body = {'name': 'Notes', 'parentId': ''}
folder_path = f'/namespaces/{ns}/folders'
folder = call(folder_path, 'POST', body, idem=folder_key)
assert call(folder_path, 'POST', body, idem=folder_key) == folder
call(folder_path, 'POST', {'name': 'Different'}, idem=folder_key, want=409)
changed = call('/entries/' + folder['id'], 'PATCH',
               {'name': 'Renamed', 'parentId': '', 'version': 1}, idem=key())
assert changed['id'] == folder['id'] and changed['version'] == 2
call('/entries/' + folder['id'], 'PATCH',
     {'name': 'Stale', 'parentId': '', 'version': 1}, idem=key(), want=409)
call('/entries/' + folder['id'], 'PATCH',
     {'name': 'Cycle', 'parentId': folder['id'], 'version': 2}, idem=key(), want=400)

# A two-part upload: missing/bad/out-of-order/repeated parts and completion replay.
data = b'A' * block + b'tail\n'
session = begin('Evidence.bin', data)
upload = '/uploads/' + session['id']
call(upload + '/complete', 'POST', {}, want=409)
call(upload + '/parts/0', 'PUT', b'wrong', want=422)
call(upload + '/parts/1', 'PUT', data[block:])
assert call(upload)['parts'] == [1]
call(upload + '/parts/0', 'PUT', data[:block])
call(upload + '/parts/0', 'PUT', data[:block])
receipt = finish(session, data)
assert call(upload + '/complete', 'POST', {}) == receipt
file_id = receipt['fileId']
assert call('/entries/' + file_id + '/download', raw=True) == data
reused = begin('Same bytes.bin', data)
assert reused['parts'] == [0, 1]
call('/uploads/' + reused['id'], 'DELETE')
other_ns = namespace('Separate reuse boundary')
isolated = begin('Same bytes.bin', data, namespace_id=other_ns)
assert isolated['parts'] == []
call('/uploads/' + isolated['id'], 'DELETE')

# Preserve both edits, and retain the old immutable revision.
edit_a, edit_b = b'first online edit', b'offline edit kept separately'
a = begin('Evidence.bin', edit_a, file_id, 1)
b = begin('Evidence.bin', edit_b, file_id, 1)
assert finish(a, edit_a)['conflict'] is False
conflict = finish(b, edit_b)
assert conflict['conflict'] is True and conflict['fileId'] != file_id
history = call('/entries/' + file_id + '/revisions')['revisions']
assert len(history) == 2
assert call('/entries/' + file_id + '/download?revision=' + receipt['revisionId'], raw=True) == data

# Server authorization changes independently of what a client renders.
call(f'/namespaces/{ns}/snapshot', who='bob', want=403)
members = f'/namespaces/{ns}/members'
call(members, 'PUT', {'userId': 'bob', 'role': 'reader'}, idem=key())
call(f'/namespaces/{ns}/snapshot', who='bob')
call(folder_path, 'POST', {'name': 'Reader denied'}, who='bob', idem=key(), want=403)
call(members, 'PUT', {'userId': 'bob', 'role': 'none'}, idem=key())
call(f'/namespaces/{ns}/changes?after=0', who='bob', want=403)

# This reserves the maximum; it does not transfer a 10 GB file.
quota_ns = namespace('Quota reservation boundary')
max_body = {'ns': quota_ns, 'parentId': '', 'name': 'Not uploaded.bin',
            'size': 10_000_000_000, 'hashes': ['0' * 64] * 2385, 'baseVersion': 0}
reservation = call('/uploads', 'POST', max_body, idem=key())
call('/uploads', 'POST', {'ns': quota_ns, 'name': 'One byte', 'size': 1,
     'hashes': [digest(b'x')], 'baseVersion': 0}, idem=key(), want=409)
call('/uploads/' + reservation['id'], 'DELETE')
call('/uploads', 'POST', dict(max_body, size=10_000_000_001), idem=key(), want=413)

# Trash/restore/purge, and an active accepted part keeping a shared block alive.
pin = begin('Pinned copy.txt', edit_a)
assert pin['parts'] == [0]
for action, version in [('trash', 2), ('restore', 3), ('trash', 4), ('purge', 5)]:
    call(f'/entries/{file_id}/{action}', 'POST', {'version': version}, idem=key())
call(f'/namespaces/{ns}/gc', 'POST', {})
assert all(e['id'] != file_id for e in snapshot()['entries'])
kept = finish(pin, edit_a)
assert call('/entries/' + kept['fileId'] + '/download', raw=True) == edit_a
assert call('/entries/' + conflict['fileId'] + '/download', raw=True) == edit_b

# More than one feed page: no assumptions about contiguous sequence numbers.
for index in range(102):
    call(folder_path, 'POST', {'name': f'Page-{index:03}'}, idem=key())
cursor, seen, pages = 0, [], 0
while True:
    page = call(f'/namespaces/{ns}/changes?after={cursor}')
    seen += [event['seq'] for event in page['changes']]
    assert page['nextCursor'] >= cursor
    cursor, pages = page['nextCursor'], pages + 1
    if not page['hasMore']:
        break
assert pages >= 2 and seen == sorted(set(seen)) and snapshot()['cursor'] == cursor
assert call(f'/namespaces/{ns}/notifications?after={cursor}')['changed'] is False
record = {'namespace': ns, 'fileId': kept['fileId'], 'sha256': digest(edit_a), 'cursor': cursor}
Path(os.environ['LAB_RECORD']).write_text(json.dumps(record, indent=2))
print('Contracts passed: identity, retries, parts, conflicts, roles, quota, lifecycle, feed pages.')
print('Restore fixture:', os.environ['LAB_RECORD'])
PY
```

Interpret what this proves carefully. The namespace isolation assertion checks accepted-part reuse, not a cryptographic proof of secrecy. The maximum-size assertion checks manifest/reservation arithmetic, not 10 GB I/O. `[0, 1]` recovery proves stored parts are inspectable; a process restart and browser reselection require the next labs. Relevant executable source evidence is [FoundationTest](../../backend/src/test/java/dev/commonplace/FoundationTest.java), [TransferTest](../../backend/src/test/java/dev/commonplace/TransferTest.java), [SyncTest](../../backend/src/test/java/dev/commonplace/SyncTest.java), and [HardeningTest](../../backend/src/test/java/dev/commonplace/HardeningTest.java). The latter adds simultaneous completions, multi-block streaming, authorization replay denial, and multi-page feed cases.

## Lab 3: restart and restore are different failures

First restart the same dataset: stop terminal A with Ctrl+C and wait for the server to exit. Restart with the same command and `DRIVE_DATA="$LAB_ROOT/live"`. In terminal B, verify the fixture without recreating it:

```bash
python3 - <<'PY'
import hashlib, json, os, urllib.request
fixture = json.load(open(os.environ['LAB_RECORD']))
base = os.environ['DRIVE_URL'] + '/api'
def get(path):
    request = urllib.request.Request(base + path, headers={
        'Authorization': 'Bearer ' + os.environ.get('ALICE_TOKEN', 'local-alice-key')})
    return urllib.request.urlopen(request, timeout=30).read()
data = get('/entries/' + fixture['fileId'] + '/download')
assert hashlib.sha256(data).hexdigest() == fixture['sha256']
snapshot = json.loads(get('/namespaces/' + fixture['namespace'] + '/snapshot'))
assert snapshot['cursor'] == fixture['cursor']
print('Same-dataset restart preserved content and cursor.')
PY
```

Now make a **cold backup**. Stop terminal A again and wait for exit before copying in terminal B:

```bash
mkdir "$LAB_ROOT/backup"
cp -pR "$LAB_ROOT/live/." "$LAB_ROOT/backup/"
```

Record the backup time. Restart the live directory in terminal A. Create a mutation after that backup in terminal B and save its cursor outside the data directory:

```bash
python3 - <<'PY'
import json, os, urllib.request, uuid
path = os.environ['LAB_RECORD']
fixture = json.load(open(path))
base = os.environ['DRIVE_URL'] + '/api/namespaces/' + fixture['namespace']
headers = {'Authorization': 'Bearer ' + os.environ.get('ALICE_TOKEN', 'local-alice-key'),
           'Content-Type': 'application/json', 'Idempotency-Key': str(uuid.uuid4())}
request = urllib.request.Request(base + '/folders', method='POST', headers=headers,
                                data=json.dumps({'name': 'After backup ' + str(uuid.uuid4())}).encode())
urllib.request.urlopen(request, timeout=30).read()
snapshot = json.load(urllib.request.urlopen(urllib.request.Request(base + '/snapshot', headers=headers)))
fixture['afterBackupCursor'] = snapshot['cursor']
assert fixture['afterBackupCursor'] > fixture['cursor']
open(path, 'w').write(json.dumps(fixture, indent=2))
print('Post-backup mutation acknowledged at cursor', fixture['afterBackupCursor'])
PY
```

Stop terminal A. Copy the cold backup into a fresh restore directory:

```bash
mkdir "$LAB_ROOT/restored"
cp -pR "$LAB_ROOT/backup/." "$LAB_ROOT/restored/"
```

Record the start of recovery. In terminal A, launch with `DRIVE_DATA="$LAB_ROOT/restored"` and `DRIVE_SEED=false`, using the same host, port, and tokens. Run the restart verification above: the backup contains that content and original cursor. Then check the newer browser cursor:

```bash
python3 - <<'PY'
import json, os, urllib.error, urllib.request
fixture = json.load(open(os.environ['LAB_RECORD']))
url = (os.environ['DRIVE_URL'] + '/api/namespaces/' + fixture['namespace']
       + '/changes?after=' + str(fixture['afterBackupCursor']))
request = urllib.request.Request(url, headers={
    'Authorization': 'Bearer ' + os.environ.get('ALICE_TOKEN', 'local-alice-key')})
try:
    urllib.request.urlopen(request, timeout=30)
    raise AssertionError('Expected a cursor ahead of the restored history')
except urllib.error.HTTPError as error:
    body = json.load(error)
    assert error.code == 409 and body['code'] == 'CURSOR_AHEAD', body
print('Restore detected the newer cursor; refresh a snapshot before retrying drafts.')
PY
```

Record the end of recovery only after download/hash and cursor checks pass. Report the observed drill RTO and which post-backup acknowledged mutation was absent. Do not claim the proposed 15-minute RPO or 60-minute RTO was achieved without that timing and recovery-point evidence. This lab deliberately makes no new writes to the restored history before checking `CURSOR_AHEAD`; [chapter 3](03-core-workflows-and-consistency.md) explains why production also needs a recovery epoch.

Optional key drill: while stopped, copy the backup into a third disposable directory, rename only that copy's `block-key.bin`, and start against it. Existing block rows must cause startup to refuse silent key replacement. Restore the matching backup key and repeat content verification. Never conduct this exercise on the only key copy. [RecoveryTest](../../backend/src/test/java/dev/commonplace/RecoveryTest.java) automates reopened-context and key-failure cases; this manual drill adds a complete server process restart and a separate restored database copy.

## Lab 4: prove the browser boundary

Use the full local application with two independent browser contexts/profiles, both Alice, pointed at the same server. A second tab in one profile shares IndexedDB and is a different experiment.

1. Open one text file in both contexts and note its observed metadata version.
2. Take context B offline, edit the text draft, and queue/save it. Keep this loaded tab open for the conflict experiment. Inspect the saved job in IndexedDB if desired; draft persistence does not imply an offline shell cache. Test reload recovery separately with the server reachable, remembering that saved drafts can retry immediately on load.
3. In context A, publish an online edit and verify a new revision on the original stable ID.
4. Bring B online and retry its saved intent. Verify B's bytes appear in a conflict copy and A's newer head remains on the original file. Download both and compare their contents.
5. Interrupt a larger upload. Reload, reselect the same file, and observe accepted part indexes rather than assuming the file chooser remained accessible. Selecting different bytes must not silently resume the old manifest.
6. Share as reader, attempt a write directly through the API, revoke membership, and request the feed/download again. Record server denial independently of cached UI state.

The product distinction to explain is browser-managed draft synchronization versus native filesystem synchronization. There is no folder watcher, arbitrary durable local file access, or simultaneous document-edit operation merge. Run the repository's frontend browser checks after changes. The [local browser tests](../../frontend/tests/local.spec.ts) cover independent-context conflicts, missing-part upload retry, and reader denial; the [Pages test](../../frontend/tests/pages.spec.ts) covers the public sample boundary, not a backend durability claim.

## Lab 5: from experiment to architecture review

Use the current repository checks as regression evidence:

```bash
cd backend
./gradlew test
```

From the repository root, build both frontend delivery modes:

```bash
npm --prefix frontend run build
npm --prefix frontend run build:pages
```

Building two modes in succession verifies their compilation; it does not start the API or prove a browser interaction. Follow the README for browser checks and deployment validation. When changing API invariants, add failure-oriented tests at the relevant boundary rather than mirroring implementation methods.

Choose one architecture exercise and submit an ADR with a state/sequence diagram, explicit failure points, and a verification plan:

- **Two application processes:** replace the JVM monitor. Show simultaneous identical names, quota near exhaustion, stale head completion, receipt-key collision, and purge versus download. Identify the target database constraint/lock for every race.
- **Object storage:** inject a crash after object upload but before part registration, then after revision commit but before response. Define orphan grace, active-reader retention, and idempotent recovery. See [operations](05-scaling-and-operations.md).
- **Bounded history:** choose retry/feed/tombstone retention horizons. Define the cursor-expiry response and offline snapshot path. Explain how a six-month-old saved operation avoids being mistaken for a new intent.
- **Measure the first bottleneck:** run metadata requests alongside a deliberately throttled local download and record transaction wait/hold and end-to-end latency. Report hardware, dataset, concurrency, byte rate, percentiles, and errors; no performance number is meaningful without that envelope.

A strong review connects requirement → mechanism → tradeoff → evidence → revisit trigger. A diagram with more boxes and no recovery protocol is not a completed architecture proposal.
