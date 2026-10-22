export type Entry = {
  id: string;
  ns: string;
  parentId: string;
  name: string;
  folder: boolean;
  head: string | null;
  version: number;
  deleted: boolean;
  updatedAt: number;
  sizeBytes: number;
};
export type Namespace = {
  id: string;
  name: string;
  ownerId: string;
  quotaBytes: number;
  role?: string;
};
export type Snapshot = {
  namespace: Namespace;
  role: string;
  entries: Entry[];
  cursor: number;
  usedBytes: number;
  reservedBytes: number;
  storedBytes: number;
};
export type Revision = {
  id: string;
  fileId: string;
  sizeBytes: number;
  author: string;
  createdAt: number;
};
export type Change = {
  seq: number;
  actor: string;
  kind: string;
  fileId: string;
  createdAt: number;
};
export type Upload = {
  id: string;
  parts: number[];
  state: string;
  expiresAt: number;
};
export type Receipt = { fileId: string; revisionId: string; conflict: boolean };
export type Job = {
  id: string;
  user: string;
  ns: string;
  name: string;
  parentId: string;
  size: number;
  hashes: string[];
  fileId?: string;
  baseVersion: number;
  session?: string;
  blob?: Blob;
  error?: string;
};
