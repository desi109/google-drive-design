import type { Entry, Job, Receipt, Upload } from "./types";
import * as disk from "./storage";
export const isSample = import.meta.env.MODE === "pages";
export const BLOCK = 4 * 1024 * 1024;
export class RequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  token: string,
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<T> {
  const headers: Record<string, string> = { Authorization: "Bearer " + token };
  if (key) headers["Idempotency-Key"] = key;
  if (body !== undefined)
    headers["Content-Type"] =
      body instanceof Blob ? "application/octet-stream" : "application/json";
  const response = await fetch("/api" + path, {
    method,
    headers,
    body:
      body === undefined
        ? undefined
        : body instanceof Blob
          ? body
          : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const e = await response.json().catch(() => ({
      code: "REQUEST_FAILED",
      message: "Request failed. Try again.",
    }));
    throw new RequestError(response.status, e.code, e.message);
  }
  return response.json();
}
export async function hashes(file: Blob, progress: (s: string) => void) {
  const result: string[] = [];
  for (let offset = 0; offset < file.size; offset += BLOCK) {
    const bytes = await file.slice(offset, offset + BLOCK).arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    result.push(
      Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""),
    );
    progress(
      "Checking file · " +
        Math.min(100, Math.round(((offset + BLOCK) / file.size) * 100)) +
        "%",
    );
  }
  return result;
}
export async function prepare(
  user: string,
  ns: string,
  parentId: string,
  file: Blob,
  name: string,
  entry: Entry | undefined,
  keep: boolean,
  progress: (s: string) => void,
): Promise<Job> {
  if (file.size > 10_000_000_000)
    throw new Error("Maximum file size is 10,000,000,000 bytes.");
  const manifest = await hashes(file, progress);
  const old = (await disk.all<Job>("job:" + user + ":")).find(
    (j) =>
      j.ns === ns &&
      j.parentId === parentId &&
      j.name === name &&
      j.fileId === entry?.id &&
      j.size === file.size &&
      j.hashes.join() === manifest.join(),
  );
  const job = old ?? {
    id: crypto.randomUUID(),
    user,
    ns,
    parentId,
    name,
    size: file.size,
    hashes: manifest,
    fileId: entry?.id,
    baseVersion: entry?.version ?? 0,
  };
  if (keep) job.blob = file;
  await disk.write("job:" + user + ":" + job.id, job);
  return job;
}
export async function transfer(
  token: string,
  job: Job,
  file: Blob,
  progress: (s: string) => void,
): Promise<Receipt> {
  try {
    if (!job.session) {
      const { user, id, blob, session, error, ...body } = job;
      const u = await api<Upload>(token, "/uploads", "POST", body, id);
      job.session = u.id;
      await disk.write("job:" + job.user + ":" + job.id, job);
    }
    const u = await api<Upload>(token, "/uploads/" + job.session);
    if (
      u.state !== "COMPLETE" &&
      (u.state !== "OPEN" || u.expiresAt <= Date.now())
    )
      throw new Error(
        "Upload expired. Discard this session and select the file again.",
      );
    if (u.state !== "COMPLETE")
      for (let i = 0; i < job.hashes.length; i++) {
        if (!u.parts.includes(i))
          await api(
            token,
            `/uploads/${job.session}/parts/${i}`,
            "PUT",
            file.slice(i * BLOCK, (i + 1) * BLOCK),
          );
        progress(
          "Uploading · " +
            Math.round(((i + 1) / job.hashes.length) * 100) +
            "%",
        );
      }
    const receipt = await api<Receipt>(
      token,
      "/uploads/" + job.session + "/complete",
      "POST",
      {},
    );
    await disk.remove("job:" + job.user + ":" + job.id);
    return receipt;
  } catch (e) {
    job.error = e instanceof Error ? e.message : "Transfer interrupted";
    await disk.write("job:" + job.user + ":" + job.id, job);
    throw e;
  }
}
export async function content(token: string, id: string, revision?: string) {
  const res = await fetch(
    `/api/entries/${id}/download${revision ? "?revision=" + encodeURIComponent(revision) : ""}`,
    {
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(1_800_000),
    },
  );
  if (!res.ok)
    throw new RequestError(
      res.status,
      "DOWNLOAD_FAILED",
      "Download failed. Check current access and try again.",
    );
  return res;
}
export function textFile(name: string) {
  return /\.(txt|md|csv|json)$/i.test(name.replace(/ \(conflict [^)]+\)$/, ""));
}

/** Ask while user activation is still live, before waiting for any response headers. */
export async function pickDestination(
  name: string,
  size: number,
): Promise<WritableStream | undefined> {
  if (size <= 64 * 1024 * 1024) return;
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (
        options: unknown,
      ) => Promise<{ createWritable(): Promise<WritableStream> }>;
    }
  ).showSaveFilePicker;
  if (!picker)
    throw new Error(
      "For downloads over 64 MiB, use desktop Chromium with the File System Access API, or the streaming API with curl.",
    );
  const handle = await picker({ suggestedName: name });
  return handle.createWritable();
}

async function boundedBlob(response: Response, limit: number): Promise<Blob> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("This browser cannot read the download stream.");
  const chunks: BlobPart[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit)
        throw new Error(
          "The response exceeds this operation's memory limit. Use a streamed download.",
        );
      chunks.push(part.value);
    }
    return new Blob(chunks);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function readText(
  response: Response,
  limit: number,
): Promise<string> {
  return (await boundedBlob(response, limit)).text();
}

export async function saveResponse(
  response: Response,
  name: string,
  size: number,
  destination?: WritableStream,
) {
  if (destination) {
    await response.body!.pipeTo(destination);
    return;
  }
  const blob = await boundedBlob(response, Math.min(size, 64 * 1024 * 1024));
  if (blob.size !== size)
    throw new Error("Download size did not match the selected revision.");
  saveBlob(blob, name);
}
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function bytes(n: number) {
  return n < 1000
    ? n + " B"
    : n < 1e6
      ? (n / 1000).toFixed(1) + " KB"
      : n < 1e9
        ? (n / 1e6).toFixed(1) + " MB"
        : (n / 1e9).toFixed(2) + " GB";
}
