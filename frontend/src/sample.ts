import type { Entry, Revision, Snapshot } from "./types";
const ns = "sample-studio",
  time = Date.UTC(2026, 9, 20, 9);
const item = (
  id: string,
  name: string,
  folder: boolean,
  parentId = "",
  size = 0,
  version = 1,
): Entry => ({
  id,
  ns,
  name,
  folder,
  parentId,
  head: folder ? null : id + "-v" + version,
  version,
  deleted: false,
  updatedAt: time,
  sizeBytes: size,
});
export const sampleText: Record<string, string> = {
  "brief-v1":
    "# Commonplace\n\nFirst draft: a quieter place for work in progress.\n",
  "brief-v2":
    "# Commonplace\n\nA quieter place for work in progress.\n\nDecisions\n- Give every file a stable identity.\n- Preserve both sides of a conflicting edit.\n- Treat notifications as hints; trust the changes feed.\n\nNext: test two browsers reconnecting after an offline edit.\n",
  "welcome-v1":
    "Welcome to Commonplace.\n\nThis public sample demonstrates folder navigation, search, revision inspection and downloads.\n\nRun the complete local application for encrypted resumable uploads, sharing enforcement and browser synchronization.\n",
  "notes-v1":
    "Field notes\n\nA disconnected client knows its last snapshot, not the current server state.\nSave the observed version with every pending edit.\nOn reconnect, preserve a stale edit as a conflict copy.\n",
  "color-v1":
    '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="480"><rect width="720" height="480" fill="#e9eef7"/><circle cx="270" cy="235" r="150" fill="#3d5cc7"/><rect x="350" y="85" width="210" height="300" rx="105" fill="#d5e3cb"/><text x="40" y="440" font-family="sans-serif" font-size="22" fill="#243344">Commonplace / Color study</text></svg>',
};
const entries = [
  item("projects", "Product studio", true),
  item("research", "Research", true),
  item("personal", "Personal", true),
  item("welcome", "Welcome.txt", false),
  item("brief", "Project brief.md", false, "projects", 0, 2),
  item("notes", "Sync field notes.txt", false, "research"),
  item("color", "Color study.svg", false, "projects"),
];
for (const e of entries)
  if (e.head) e.sizeBytes = new Blob([sampleText[e.head]]).size;
export const sampleSnapshot: Snapshot = {
  namespace: {
    id: ns,
    name: "Studio workspace",
    ownerId: "alice",
    quotaBytes: 10_000_000_000,
  },
  role: "reader",
  entries,
  cursor: 0,
  usedBytes: Object.values(sampleText).reduce(
    (n, t) => n + new Blob([t]).size,
    0,
  ),
  reservedBytes: 0,
  storedBytes: 0,
};
export const sampleRevisions = (entry: Entry): Revision[] =>
  Object.keys(sampleText)
    .filter((k) => k.startsWith(entry.id + "-v"))
    .reverse()
    .map((id, i) => ({
      id,
      fileId: entry.id,
      sizeBytes: new Blob([sampleText[id]]).size,
      author: "alice",
      createdAt: time - i * 86_400_000,
    }));
