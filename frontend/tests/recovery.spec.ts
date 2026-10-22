import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
  type Download,
} from "@playwright/test";

const auth = (user = "alice") => ({
  Authorization: `Bearer local-${user}-key`,
});
const mutationHeaders = (user = "alice", key = randomUUID()) => ({
  ...auth(user),
  "Idempotency-Key": key,
});
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

async function namespace(request: APIRequestContext, label: string) {
  const response = await request.post("/api/namespaces", {
    headers: mutationHeaders(),
    data: { name: `ZZ recovery ${label} ${randomUUID()}` },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).id as string;
}

async function file(
  request: APIRequestContext,
  ns: string,
  name: string,
  text: string,
  target?: { fileId: string; version: number },
) {
  const response = await request.post("/api/uploads", {
    headers: mutationHeaders(),
    data: {
      ns,
      name,
      parentId: "",
      size: Buffer.byteLength(text),
      hashes: [hash(text)],
      baseVersion: target?.version ?? 0,
      ...(target ? { fileId: target.fileId } : {}),
    },
  });
  expect(response.status()).toBe(200);
  const upload = await response.json();
  const part = await request.put(`/api/uploads/${upload.id}/parts/0`, {
    headers: { ...auth(), "Content-Type": "application/octet-stream" },
    data: Buffer.from(text),
  });
  expect(part.status()).toBe(200);
  const completed = await request.post(`/api/uploads/${upload.id}/complete`, {
    headers: auth(),
    data: {},
  });
  expect(completed.status()).toBe(200);
  return completed.json() as Promise<{
    fileId: string;
    revisionId: string;
    conflict: boolean;
  }>;
}

async function identity(page: Page, user: string, ns: string) {
  await page.addInitScript(
    ({ user, ns }) => {
      localStorage.setItem("cp-user", user);
      localStorage.setItem(`cp-token-${user}`, `local-${user}-key`);
      localStorage.setItem(`cp-ns-${user}`, ns);
    },
    { user, ns },
  );
}

async function downloadedText(download: Download) {
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFile(path!, "utf8");
}

test("download preserves the observed revision when another client replaces the head", async ({
  page,
  request,
}) => {
  const ns = await namespace(request, "Observed revision");
  const name = `observed-${randomUUID()}.bin`;
  const original = "the revision this browser observed";
  const replacement = "a newer revision from another client";
  const receipt = await file(request, ns, name, original);
  const snapshot = await request.get(`/api/namespaces/${ns}/snapshot`, {
    headers: auth(),
  });
  expect(snapshot.status()).toBe(200);
  const observed = await snapshot.json();
  // Keep this client's metadata stale while another real API client advances the server head.
  await page.route(`**/api/namespaces/${ns}/snapshot`, (route) =>
    route.fulfill({ json: observed }),
  );
  await identity(page, "alice", ns);
  await page.goto("/");
  await page
    .getByRole("button", { name: `Inspect ${name}`, exact: true })
    .click();
  const changed = await file(request, ns, name, replacement, {
    fileId: receipt.fileId,
    version: 1,
  });
  expect(changed.revisionId).not.toBe(receipt.revisionId);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const result = await pending;
  expect(result.suggestedFilename()).toBe(name);
  expect(await downloadedText(result)).toBe(original);
});

test("a revoked draft remains exportable and locally discardable while another namespace synchronizes", async ({
  page,
  request,
}) => {
  const a = await namespace(request, "Revoked draft");
  const b = await namespace(request, "Recoverable draft");
  const nameA = `revoked-${randomUUID()}.txt`,
    nameB = `allowed-${randomUUID()}.txt`;
  const originalA = await file(request, a, nameA, "original A");
  const originalB = await file(request, b, nameB, "original B");
  for (const ns of [a, b]) {
    const shared = await request.put(`/api/namespaces/${ns}/members`, {
      headers: mutationHeaders(),
      data: { userId: "bob", role: "writer" },
    });
    expect(shared.status()).toBe(200);
  }
  const textA = "retained private draft A",
    textB = "synchronize this valid draft B";
  const idA = `00-recovery-${randomUUID()}`,
    idB = `99-recovery-${randomUUID()}`;
  const bodyA = {
    ns: a,
    parentId: "",
    name: nameA,
    fileId: originalA.fileId,
    baseVersion: 1,
    size: Buffer.byteLength(textA),
    hashes: [hash(textA)],
  };
  const started = await request.post("/api/uploads", {
    headers: mutationHeaders("bob", idA),
    data: bodyA,
  });
  expect(started.status()).toBe(200);
  const sessionA = (await started.json()).id as string;
  const revoked = await request.put(`/api/namespaces/${a}/members`, {
    headers: mutationHeaders(),
    data: { userId: "bob", role: "none" },
  });
  expect(revoked.status()).toBe(200);
  await identity(page, "bob", b);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: `Inspect ${nameB}`, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Go offline", exact: true }).click();
  await page.evaluate(
    async ({ drafts }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open("commonplace-v1", 1);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("records", "readwrite");
          for (const { text, ...job } of drafts) {
            tx.objectStore("records").put(
              { ...job, blob: new Blob([text], { type: "text/plain" }) },
              `job:bob:${job.id}`,
            );
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    {
      drafts: [
        { ...bodyA, id: idA, user: "bob", session: sessionA, text: textA },
        {
          ns: b,
          parentId: "",
          name: nameB,
          fileId: originalB.fileId,
          baseVersion: 1,
          size: Buffer.byteLength(textB),
          hashes: [hash(textB)],
          id: idB,
          user: "bob",
          text: textB,
        },
      ],
    },
  );
  await page.getByRole("button", { name: "Go online", exact: true }).click();
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `/api/entries/${originalB.fileId}/download`,
          { headers: auth("bob") },
        );
        return response.text();
      },
      { timeout: 20_000 },
    )
    .toBe(textB);
  const retained = page.locator(".outbox-job").filter({ hasText: nameA });
  await expect(retained).toBeVisible();
  const exported = page.waitForEvent("download");
  await retained
    .getByRole("button", { name: "Export draft", exact: true })
    .click();
  expect(await downloadedText(await exported)).toBe(textA);
  // The backend still denies the revoked session; local recovery must work independently.
  const denied = await request.delete(`/api/uploads/${sessionA}`, {
    headers: auth("bob"),
  });
  expect(denied.status()).toBe(403);
  await retained
    .getByRole("button", { name: "Discard session", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Discard this pending session?", exact: true })
    .getByRole("button", { name: "Discard session", exact: true })
    .click();
  await expect(retained).toHaveCount(0);
  expect(
    await page.evaluate(async (key) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open("commonplace-v1", 1);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      try {
        return await new Promise<boolean>((resolve, reject) => {
          const tx = db.transaction("records");
          const read = tx.objectStore("records").get(key);
          read.onsuccess = () => resolve(read.result === undefined);
          read.onerror = () => reject(read.error);
        });
      } finally {
        db.close();
      }
    }, `job:bob:${idA}`),
  ).toBe(true);
});

test("large download opens the save picker before slow response headers consume user activation", async ({
  page,
  request,
}) => {
  const ns = await namespace(request, "Streaming picker");
  const name = `stream-${randomUUID()}.bin`,
    text = "small streamed fixture";
  const receipt = await file(request, ns, name, text);
  const response = await request.get(`/api/namespaces/${ns}/snapshot`, {
    headers: auth(),
  });
  expect(response.status()).toBe(200);
  const snapshot = await response.json();
  snapshot.entries.find(
    (entry: { id: string }) => entry.id === receipt.fileId,
  ).sizeBytes = 64 * 1024 * 1024 + 1;
  await page.route(`**/api/namespaces/${ns}/snapshot`, (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.addInitScript(() => {
    const state = { pickerActive: false, bytes: [] as number[], saved: false };
    (window as unknown as { recoveryStream: typeof state }).recoveryStream =
      state;
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async () => {
        state.pickerActive = navigator.userActivation.isActive;
        if (!state.pickerActive)
          throw new DOMException(
            "Save picker requires user activation",
            "SecurityError",
          );
        return {
          createWritable: async () =>
            new WritableStream({
              write(chunk) {
                state.bytes.push(...new Uint8Array(chunk));
              },
              close() {
                state.saved = true;
              },
            }),
        };
      },
    });
  });
  await page.route(
    `**/api/entries/${receipt.fileId}/download*`,
    async (route) => {
      // Chromium's transient activation expires after about five seconds. The response is tiny.
      await new Promise((resolve) => setTimeout(resolve, 5_500));
      await route.fulfill({
        contentType: "application/octet-stream",
        body: text,
      });
    },
  );
  await identity(page, "alice", ns);
  await page.goto("/");
  await page
    .getByRole("button", { name: `Inspect ${name}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { recoveryStream: { saved: boolean } })
              .recoveryStream.saved,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  expect(
    await page.evaluate(() => {
      const state = (
        window as unknown as {
          recoveryStream: { pickerActive: boolean; bytes: number[] };
        }
      ).recoveryStream;
      return {
        pickerActive: state.pickerActive,
        text: new TextDecoder().decode(new Uint8Array(state.bytes)),
      };
    }),
  ).toEqual({ pickerActive: true, text });
});
