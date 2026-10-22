import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Folder,
  Files,
  Search,
  Upload,
  Plus,
  ChevronRight,
  Download,
  History,
  FileText,
  Image,
  ArrowUpRight,
  Cloud,
  CloudOff,
  Check,
  RefreshCw,
  Trash2,
  Users,
  Activity,
  BookOpen,
  X,
  ArrowLeft,
  Edit3,
  MoreHorizontal,
  HardDrive,
  ShieldCheck,
  CornerDownRight,
} from "lucide-react";
import type {
  Change,
  Entry,
  Job,
  Namespace,
  Revision,
  Snapshot,
} from "./types";
import {
  api,
  bytes,
  content,
  isSample,
  prepare,
  RequestError,
  saveBlob,
  saveResponse,
  pickDestination,
  readText,
  textFile,
  transfer,
} from "./client";
import * as disk from "./storage";
import { sampleRevisions, sampleSnapshot, sampleText } from "./sample";

const guide =
  "https://github.com/desi109/google-drive-design/blob/main/docs/architecture.md";
const day = (time: number) =>
  new Date(time).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Try again.";
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="modal-title">
        <h2 id="dialog-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function FileIcon({ entry, large = false }: { entry: Entry; large?: boolean }) {
  const Icon = entry.folder
    ? Folder
    : entry.name.endsWith(".svg")
      ? Image
      : FileText;
  return (
    <span
      className={
        "file-icon " +
        (entry.folder
          ? "folder-icon"
          : entry.name.endsWith(".svg")
            ? "image-icon"
            : "text-icon") +
        (large ? " large" : "")
      }
    >
      <Icon size={large ? 34 : 20} aria-hidden="true" />
    </span>
  );
}

export default function App() {
  const [user, setUser] = useState(localStorage.getItem("cp-user") ?? "alice");
  const [token, setToken] = useState(
    localStorage.getItem("cp-token-" + user) ?? "local-" + user + "-key",
  );
  const [accountUser, setAccountUser] = useState(user),
    [accountToken, setAccountToken] = useState(token);
  const identityRef = useRef(user + token);
  identityRef.current = user + token;
  const [spaces, setSpaces] = useState<Namespace[]>(
    isSample ? [sampleSnapshot.namespace] : [],
  );
  const ns = useRef(localStorage.getItem("cp-ns-" + user) ?? "");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(
      isSample ? sampleSnapshot : null,
    ),
    snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const [loading, setLoading] = useState(!isSample),
    [online, setOnline] = useState(navigator.onLine),
    [paused, setPaused] = useState(false),
    [connected, setConnected] = useState(false);
  const [tab, setTab] = useState("files"),
    [search, setSearch] = useState(""),
    [folder, setFolder] = useState(
      decodeURIComponent(location.hash.replace("#/folder/", "")).replace(
        /^#.*$/,
        "",
      ),
    );
  const [selected, setSelected] = useState(""),
    [revisions, setRevisions] = useState<Revision[]>([]),
    [history, setHistory] = useState(false),
    [preview, setPreview] = useState("");
  const [events, setEvents] = useState<Change[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const [modal, setModal] = useState(""),
    [formName, setFormName] = useState(""),
    [formParent, setFormParent] = useState(""),
    [shareUser, setShareUser] = useState("bob"),
    [shareRole, setShareRole] = useState("reader");
  const [members, setMembers] = useState<{ userId: string; role: string }[]>(
      [],
    ),
    [editor, setEditor] = useState<{ entry: Entry; text: string } | null>(null),
    [confirm, setConfirm] = useState<{ entry: Entry; action: string } | null>(
      null,
    );
  const input = useRef<HTMLInputElement>(null),
    replace = useRef<Entry | undefined>(undefined),
    syncing = useRef(false),
    flushing = useRef(false),
    mutating = useRef(false);
  const available = online && !paused;
  const canWrite = !isSample && snapshot?.role !== "reader";
  const entry = snapshot?.entries.find((e) => e.id === selected);
  const rootEntries = snapshot?.entries ?? [];
  const currentFolder = rootEntries.find(
    (e) => e.id === folder && !e.deleted && e.folder,
  );
  const jobsRefresh = useCallback(
    async () => setJobs(await disk.all<Job>("job:" + user + ":")),
    [user],
  );
  const sync = useCallback(
    async (force = false) => {
      if (isSample || !available || syncing.current) return;
      syncing.current = true;
      const identity = user + token;
      try {
        const result = await api<{ namespaces: Namespace[] }>(
          token,
          "/namespaces",
        );
        if (identity !== identityRef.current) return;
        setSpaces(result.namespaces);
        await disk.write("spaces:" + user, result.namespaces);
        const previous = ns.current;
        if (previous && !result.namespaces.some((n) => n.id === previous)) {
          await disk.remove("snapshot:" + user + ":" + previous);
          setSnapshot(null);
          snapshotRef.current = null;
        }
        const chosen =
          result.namespaces.find((n) => n.id === ns.current) ??
          result.namespaces[0];
        if (!chosen) {
          setSnapshot(null);
          setLoading(false);
          setConnected(true);
          return;
        }
        ns.current = chosen.id;
        localStorage.setItem("cp-ns-" + user, chosen.id);
        const old = snapshotRef.current;
        if (old?.namespace.id === chosen.id && !force) {
          const hint = await api<{ changed: boolean }>(
            token,
            `/namespaces/${chosen.id}/notifications?after=${old.cursor}`,
          );
          if (!hint.changed) {
            setConnected(true);
            return;
          }
        }
        if (old?.namespace.id === chosen.id) {
          let cursor = old.cursor;
          const changes: Change[] = [];
          for (let i = 0; i < 10; i++) {
            try {
              const feed = await api<{
                changes: Change[];
                nextCursor: number;
                hasMore: boolean;
              }>(token, `/namespaces/${chosen.id}/changes?after=${cursor}`);
              changes.push(...feed.changes);
              cursor = feed.nextCursor;
              if (!feed.hasMore) break;
            } catch (e) {
              if (e instanceof RequestError && e.code === "CURSOR_AHEAD") break;
              throw e;
            }
          }
          if (changes.length)
            setEvents((previous) =>
              [...changes.reverse(), ...previous].slice(0, 100),
            );
        }
        const next = await api<Snapshot>(
          token,
          `/namespaces/${chosen.id}/snapshot`,
        );
        if (identity !== identityRef.current) return;
        setSnapshot(next);
        snapshotRef.current = next;
        await disk.write("snapshot:" + user + ":" + chosen.id, next);
        setConnected(true);
      } catch (e) {
        if (identity !== identityRef.current) return;
        setConnected(false);
        if (e instanceof RequestError) {
          setError(e.message);
          if (e.status === 401 || e.status === 403) {
            setSnapshot(null);
            await disk.remove("snapshot:" + user + ":" + ns.current);
          }
        }
      } finally {
        syncing.current = false;
        setLoading(false);
      }
    },
    [user, token, available],
  );
  const flush = useCallback(async () => {
    if (isSample || !available || flushing.current) return;
    flushing.current = true;
    try {
      for (const job of await disk.all<Job>("job:" + user + ":"))
        if (job.blob) {
          setBusy("Reconnecting draft…");
          try {
            const r = await transfer(token, job, job.blob, setBusy);
            setNotice(
              r.conflict
                ? "Conflicting edit preserved as a separate file."
                : "Draft synchronized.",
            );
          } catch (e) {
            setError(errorMessage(e) + " Your draft is retained.");
            // One inaccessible or expired namespace must not block other saved drafts.
            continue;
          }
        }
    } finally {
      flushing.current = false;
      setBusy("");
      await jobsRefresh();
      await sync(true);
    }
  }, [user, token, available, jobsRefresh, sync]);
  useEffect(() => {
    if (isSample) return;
    let active = true;
    (async () => {
      const cached = await disk.read<Snapshot>(
        "snapshot:" + user + ":" + ns.current,
      );
      if (active && cached) setSnapshot(cached);
      const cachedSpaces = await disk.read<Namespace[]>("spaces:" + user);
      if (active && cachedSpaces) setSpaces(cachedSpaces);
      await jobsRefresh();
      await sync(true);
      await flush();
    })().catch((e) => setError("Browser storage: " + errorMessage(e)));
    const timer = setInterval(
      () => void sync().catch((e) => setError(errorMessage(e))),
      2000,
    );
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [user, token, available, sync, flush, jobsRefresh]);
  useEffect(() => {
    const on = () => setOnline(true),
      off = () => {
        setOnline(false);
        setConnected(false);
      },
      hash = () =>
        setFolder(
          decodeURIComponent(location.hash.replace("#/folder/", "")).replace(
            /^#.*$/,
            "",
          ),
        );
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("hashchange", hash);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("hashchange", hash);
    };
  }, []);
  useEffect(() => {
    setHistory(false);
    setPreview("");
    if (!entry || entry.folder) {
      setRevisions([]);
      return;
    }
    let active = true;
    (async () => {
      const rs = isSample
        ? sampleRevisions(entry)
        : (
            await api<{ revisions: Revision[] }>(
              token,
              `/entries/${entry.id}/revisions`,
            )
          ).revisions;
      if (!active) return;
      setRevisions(rs);
      if (entry.sizeBytes <= 64 * 1024 && textFile(entry.name)) {
        const text = isSample
          ? sampleText[entry.head!]
          : await readText(
              await content(token, entry.id, entry.head!),
              64 * 1024,
            );
        if (active) setPreview(text);
      }
    })().catch((e) => setError(errorMessage(e)));
    return () => {
      active = false;
    };
  }, [entry?.id, entry?.head, token]);
  function go(id: string) {
    setSearch("");
    setTab("files");
    setSelected("");
    location.hash = id ? "#/folder/" + encodeURIComponent(id) : "#/";
    setFolder(id);
  }
  async function action(fn: () => Promise<unknown>, message: string) {
    if (mutating.current) return;
    mutating.current = true;
    setError("");
    setBusy("Saving…");
    try {
      await fn();
      setNotice(message);
      setModal("");
      setConfirm(null);
      await sync(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      mutating.current = false;
      setBusy("");
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = ns.current,
      key = crypto.randomUUID();
    if (modal === "namespace")
      await action(
        () => api(token, "/namespaces", "POST", { name: formName }, key),
        "Namespace created.",
      );
    if (modal === "folder")
      await action(
        () =>
          api(
            token,
            `/namespaces/${n}/folders`,
            "POST",
            { name: formName, parentId: folder },
            key,
          ),
        "Folder created.",
      );
    if (modal === "rename" && entry)
      await action(
        () =>
          api(
            token,
            `/entries/${entry.id}`,
            "PATCH",
            { name: formName, parentId: formParent, version: entry.version },
            key,
          ),
        "File details updated.",
      );
    if (modal === "share")
      await action(
        () =>
          api(
            token,
            `/namespaces/${n}/members`,
            "PUT",
            { userId: shareUser, role: shareRole },
            key,
          ),
        "Sharing updated.",
      );
  }
  async function upload(file: File, target?: Entry) {
    if (!snapshot) return;
    setError("");
    setBusy("Checking file…");
    try {
      const job = await prepare(
        user,
        snapshot.namespace.id,
        folder,
        file,
        target?.name ?? file.name,
        target,
        false,
        setBusy,
      );
      await jobsRefresh();
      if (!available) {
        setNotice(
          "Upload registered in this browser. Reselect the same file when online to transfer it.",
        );
        return;
      }
      const result = await transfer(token, job, file, setBusy);
      setNotice(
        result.conflict
          ? "Conflicting edit preserved as a separate file."
          : "Upload complete.",
      );
      await jobsRefresh();
      await sync(true);
    } catch (e) {
      setError(
        errorMessage(e) +
          " Reselect the same file to resume an interrupted transfer.",
      );
      await jobsRefresh();
    } finally {
      setBusy("");
    }
  }
  async function saveDraft(e: FormEvent) {
    e.preventDefault();
    if (!editor || !snapshot) return;
    const baseline = editor.entry,
      blob = new Blob([editor.text], { type: "text/plain" });
    if (blob.size > 1_048_576) {
      setError(
        "Text drafts are limited to 1 MiB. Use file upload for larger revisions.",
      );
      return;
    }
    setBusy("Saving draft…");
    setError("");
    try {
      const job = await prepare(
        user,
        snapshot.namespace.id,
        baseline.parentId,
        blob,
        baseline.name,
        baseline,
        true,
        setBusy,
      );
      setEditor(null);
      await jobsRefresh();
      if (available) {
        const receipt = await transfer(token, job, blob, setBusy);
        setNotice(
          receipt.conflict
            ? "Conflicting edit preserved as a separate file."
            : "Revision saved.",
        );
        await jobsRefresh();
        await sync(true);
      } else
        setNotice(
          "Draft saved offline in this browser. It will synchronize when you reconnect.",
        );
    } catch (e) {
      setError(errorMessage(e) + " Your queued draft is retained.");
      await jobsRefresh();
    } finally {
      setBusy("");
    }
  }
  async function download(e: Entry, revision?: Revision) {
    setError("");
    try {
      if (isSample)
        saveBlob(new Blob([sampleText[revision?.id ?? e.head!]]), e.name);
      else {
        const size = revision?.sizeBytes ?? e.sizeBytes;
        const destination = await pickDestination(e.name, size);
        try {
          await saveResponse(
            await content(token, e.id, revision?.id ?? e.head!),
            e.name,
            size,
            destination,
          );
        } catch (error) {
          await destination?.abort(error).catch(() => {});
          throw error;
        }
      }
      setNotice("Download ready.");
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function openEditor() {
    if (!entry) return;
    try {
      if (entry.sizeBytes > 1_048_576)
        throw new Error("Use Replace file for revisions larger than 1 MiB.");
      const text =
        preview ||
        (await readText(
          await content(token, entry.id, entry.head!),
          1_048_576,
        ));
      setEditor({ entry: { ...entry }, text });
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function sharing() {
    setError("");
    try {
      setMembers(
        (
          await api<{ members: { userId: string; role: string }[] }>(
            token,
            `/namespaces/${ns.current}/members`,
          )
        ).members,
      );
      setModal("share");
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const visible = rootEntries.filter((e) =>
    tab === "trash"
      ? e.deleted
      : !e.deleted &&
        (search
          ? e.name.toLowerCase().includes(search.toLowerCase())
          : e.parentId === folder),
  );
  const folders = visible.filter((e) => e.folder),
    files = visible.filter((e) => !e.folder);
  const crumbs: Entry[] = [];
  let ancestor = currentFolder;
  while (ancestor && crumbs.length < 50) {
    crumbs.unshift(ancestor);
    ancestor = rootEntries.find((e) => e.id === ancestor!.parentId);
  }
  const activeJobs = jobs;
  const status = isSample
    ? "Public sample"
    : !available
      ? "Offline · cached"
      : connected
        ? "Up to date"
        : "Reconnecting";
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to files
      </a>
      <aside className="sidebar">
        <a className="brand" href="#/" onClick={() => go("")}>
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          commonplace<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">Your workspace</div>
        <label className="workspace-select">
          <span className="sr-only">Namespace</span>
          <select
            value={snapshot?.namespace.id ?? ""}
            onChange={(e) => {
              ns.current = e.target.value;
              go("");
              setSnapshot(null);
              void sync(true);
            }}
            disabled={isSample || !spaces.length}
          >
            {spaces.length ? (
              spaces.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))
            ) : (
              <option value="">No namespace yet</option>
            )}
          </select>
        </label>
        <button
          className="upload-primary"
          disabled={isSample || !canWrite || !snapshot || !!busy}
          title={
            isSample ? "Uploads require the full local application" : undefined
          }
          onClick={() => {
            replace.current = undefined;
            input.current?.click();
          }}
        >
          <Plus size={20} aria-hidden="true" /> Upload file
        </button>
        <nav aria-label="Main navigation">
          <button
            className={tab === "files" ? "nav-active" : ""}
            onClick={() => {
              setTab("files");
              go("");
            }}
          >
            <Files size={19} aria-hidden="true" /> My files
          </button>
          <button
            className={tab === "activity" ? "nav-active" : ""}
            onClick={() => setTab("activity")}
          >
            <Activity size={19} aria-hidden="true" /> Activity
            {events.length > 0 && (
              <span className="nav-count">{events.length}</span>
            )}
          </button>
          <button
            className={tab === "trash" ? "nav-active" : ""}
            onClick={() => {
              setTab("trash");
              setSelected("");
              setSearch("");
            }}
          >
            <Trash2 size={19} aria-hidden="true" /> Trash
          </button>
          <a href={guide} target="_blank" rel="noreferrer">
            <BookOpen size={19} aria-hidden="true" /> Architecture workshop
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="storage-heading">
            <HardDrive size={18} aria-hidden="true" />
            <span>{isSample ? "Sample library" : "Namespace storage"}</span>
          </div>
          <div className="quota-bar">
            <span
              style={{
                width:
                  Math.max(
                    isSample ? 0 : 0.5,
                    ((snapshot?.usedBytes ?? 0) /
                      (snapshot?.namespace.quotaBytes ?? 1)) *
                      100,
                  ) + "%",
              }}
            />
          </div>
          <p>{bytes(snapshot?.usedBytes ?? 0)} of 10 GB logical quota</p>
          {!isSample && (
            <p className="storage-detail">
              {bytes(snapshot?.reservedBytes ?? 0)} reserved
              <br />
              {bytes(snapshot?.storedBytes ?? 0)} encrypted blocks*
            </p>
          )}
          <a
            className="storage-help"
            href={guide + "#acceptance-criteria"}
            target="_blank"
            rel="noreferrer"
          >
            {isSample
              ? "Explore the full application"
              : "*Excludes database overhead"}
            <ArrowUpRight size={13} />
          </a>
        </div>
        <div className="account">
          <span className="avatar">
            {isSample ? "A" : user[0].toUpperCase()}
          </span>
          <div>
            <strong>
              {isSample ? "Alex Morgan" : user[0].toUpperCase() + user.slice(1)}
            </strong>
            <span>
              {isSample
                ? "Sample workspace"
                : (snapshot?.role ?? "Local account")}
            </span>
          </div>
          {!isSample && (
            <button
              className="icon-button"
              aria-label="Account settings"
              onClick={() => {
                setAccountUser(user);
                setAccountToken(token);
                setModal("account");
              }}
            >
              <MoreHorizontal size={20} />
            </button>
          )}
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-path">
            <Cloud size={19} aria-hidden="true" />
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>
              {tab === "files"
                ? "My files"
                : tab === "trash"
                  ? "Trash"
                  : "Activity"}
            </strong>
          </div>
          <div
            className={
              "connection " + (!available && !isSample ? "offline" : "")
            }
          >
            {isSample ? (
              <ShieldCheck size={15} />
            ) : available && connected ? (
              <Check size={15} />
            ) : (
              <CloudOff size={15} />
            )}
            <span>{status}</span>
          </div>
        </header>
        <main id="main-content">
          {isSample && (
            <div className="sample-banner">
              <span className="sample-dot" />
              <p>
                You're exploring a public sample.{" "}
                <strong>
                  Uploads, synchronization and permission enforcement run in the
                  full local application.
                </strong>
              </p>
              <a
                href="https://github.com/desi109/google-drive-design#quick-start"
                target="_blank"
                rel="noreferrer"
              >
                Run locally <ArrowUpRight size={15} />
              </a>
            </div>
          )}
          {!isSample && (
            <div className="local-banner">
              <span>
                <span className="sample-dot" />
                Browser synchronization lab · independent client{" "}
                {localStorage.getItem("cp-client") ??
                  (() => {
                    const id = crypto.randomUUID().slice(0, 6);
                    localStorage.setItem("cp-client", id);
                    return id;
                  })()}
              </span>
              <button disabled={!!busy} onClick={() => setPaused(!paused)}>
                {paused ? "Go online" : "Go offline"}
              </button>
              <button
                onClick={() => {
                  setFormName("");
                  setModal("namespace");
                }}
                disabled={!available}
              >
                New namespace
              </button>
            </div>
          )}
          <div className="heading-row">
            <div>
              <h1>
                {tab === "files"
                  ? search
                    ? "Search results"
                    : (currentFolder?.name ?? "Your work, well kept.")
                  : tab === "trash"
                    ? "A little room to reconsider."
                    : "What’s been happening."}
              </h1>
              <p>
                {tab === "files"
                  ? "Files, drafts, and all the versions in between."
                  : tab === "trash"
                    ? "Trashed files keep their revisions until an owner purges them."
                    : "A durable record of changes in this namespace."}
              </p>
            </div>
            <div className="heading-actions">
              {!isSample && snapshot?.role === "owner" && (
                <button
                  className="quiet-button"
                  onClick={() => void sharing()}
                  disabled={!available}
                >
                  <Users size={17} /> Share
                </button>
              )}
              <a
                className="icon-button github-link"
                aria-label="View source on GitHub"
                href="https://github.com/desi109/google-drive-design"
                target="_blank"
                rel="noreferrer"
              >
                <ArrowUpRight size={20} />
              </a>
            </div>
          </div>
          <div className="toolbar">
            <label className="search">
              <Search size={18} aria-hidden="true" />
              <input
                type="search"
                aria-label="Search files"
                placeholder="Search your files"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setTab("files");
                }}
              />
              <span className="search-hint">by name</span>
            </label>
            <div className="toolbar-actions">
              {!isSample && (
                <button
                  className="quiet-button"
                  onClick={() => void sync(true)}
                  disabled={!available || !!busy}
                >
                  <RefreshCw size={16} /> Refresh
                </button>
              )}
              <button
                className="quiet-button"
                disabled={isSample || !canWrite || !available || !!busy}
                onClick={() => {
                  setFormName("");
                  setModal("folder");
                }}
              >
                <Folder size={17} /> New folder
              </button>
            </div>
          </div>
          {(error || notice || busy) && (
            <div
              className={"feedback " + (error ? "feedback-error" : "")}
              role={error ? "alert" : "status"}
            >
              <span>{busy || error || notice}</span>
              <button
                aria-label="Dismiss message"
                className="icon-button"
                onClick={() => {
                  setError("");
                  setNotice("");
                }}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {activeJobs.length > 0 && (
            <section className="outbox">
              <div>
                <CloudOff size={19} />
                <strong>
                  {activeJobs.length} pending{" "}
                  {activeJobs.length === 1 ? "transfer" : "transfers"}
                </strong>
                <span>
                  {activeJobs.some((j) => j.blob)
                    ? "Text drafts are saved in this browser."
                    : "Reselect the same file to resume its session."}
                </span>
              </div>
              <button
                onClick={() => void flush()}
                disabled={!available || !!busy}
              >
                Retry saved drafts
              </button>
              {activeJobs.map((j) => (
                <div className="outbox-job" key={j.id}>
                  <span>
                    {j.name}
                    {j.error ? " — " + j.error : ""}
                  </span>
                  {j.blob && (
                    <button onClick={() => saveBlob(j.blob!, j.name)}>
                      Export draft
                    </button>
                  )}
                  <button onClick={() => setModal("discard:" + j.id)}>
                    Discard session
                  </button>
                </div>
              ))}
            </section>
          )}
          {loading ? (
            <div className="empty-state">
              <RefreshCw size={30} />
              <h2>Opening your workspace…</h2>
            </div>
          ) : !snapshot ? (
            <div className="empty-state">
              <Folder size={38} />
              <h2>
                {available
                  ? "Create your first namespace"
                  : "No cached workspace"}
              </h2>
              <p>
                {available
                  ? "Start with a namespace, then add folders and files."
                  : "Connect to load this browser’s first snapshot."}
              </p>
              {available && (
                <button
                  className="primary-button"
                  onClick={() => {
                    setFormName("My workspace");
                    setModal("namespace");
                  }}
                >
                  Create namespace
                </button>
              )}
            </div>
          ) : tab === "activity" ? (
            <section className="activity-list">
              <h2>Recent changes</h2>
              {isSample ? (
                <>
                  <p>
                    Public sample content is fixed. Run locally to see events
                    from independent browser clients.
                  </p>
                  <div className="activity-item">
                    <History size={20} />
                    <div>
                      <strong>Project brief.md</strong>
                      <p>Two revisions preserved in Product studio.</p>
                    </div>
                    <span>Oct 20</span>
                  </div>
                </>
              ) : events.length ? (
                events.map((e) => (
                  <div key={e.seq} className="activity-item">
                    <Activity size={18} />
                    <div>
                      <strong>{e.kind.replaceAll("_", " ")}</strong>
                      <p>
                        {e.actor} ·{" "}
                        {rootEntries.find((f) => f.id === e.fileId)?.name ??
                          e.fileId ??
                          "Namespace"}
                      </p>
                    </div>
                    <span>{day(e.createdAt)}</span>
                  </div>
                ))
              ) : (
                <p>
                  New events appear here while this client is connected. The
                  server retains the full cursor feed.
                </p>
              )}
            </section>
          ) : (
            <>
              <div className="breadcrumbs">
                <button onClick={() => go("")}>My files</button>
                {crumbs.map((c) => (
                  <span key={c.id}>
                    <ChevronRight size={13} />
                    <button onClick={() => go(c.id)}>{c.name}</button>
                  </span>
                ))}
                {search && (
                  <>
                    <ChevronRight size={13} />
                    <span>Search across namespace</span>
                  </>
                )}
              </div>
              <div
                className={"library-layout " + (entry ? "has-inspector" : "")}
              >
                <div className="library">
                  {folders.length > 0 && (
                    <section className="folders-section">
                      <div className="section-title">
                        <h2>
                          {search
                            ? "Matching folders"
                            : tab === "trash"
                              ? "Trashed folders"
                              : "Folders"}
                        </h2>
                        <span>{folders.length} folders</span>
                      </div>
                      <div className="folder-grid">
                        {folders.map((f, i) => (
                          <button
                            key={f.id}
                            className={"folder-card folder-color-" + (i % 3)}
                            aria-label={
                              (tab === "trash" ? "Inspect " : "Open ") + f.name
                            }
                            onClick={() =>
                              tab === "trash" ? setSelected(f.id) : go(f.id)
                            }
                          >
                            <span className="folder-tab" />
                            <Folder
                              size={29}
                              fill="currentColor"
                              strokeWidth={1}
                              aria-hidden="true"
                            />
                            <strong>{f.name}</strong>
                            <span>
                              {
                                rootEntries.filter(
                                  (e) => e.parentId === f.id && !e.deleted,
                                ).length
                              }{" "}
                              items
                            </span>
                            <ChevronRight size={17} className="folder-arrow" />
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                  <section className="files-section">
                    <div className="section-title">
                      <h2>
                        {search
                          ? "Matching files"
                          : tab === "trash"
                            ? "Trashed files"
                            : "Files"}
                      </h2>
                      <span>
                        {files.length} {files.length === 1 ? "file" : "files"}
                      </span>
                    </div>
                    {files.length ? (
                      <div className="table-container">
                        <table>
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th className="date-column">Modified</th>
                              <th>Size</th>
                              <th>
                                <span className="sr-only">Inspect</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {files.map((f) => (
                              <tr
                                key={f.id}
                                className={
                                  selected === f.id ? "selected-row" : ""
                                }
                              >
                                <td>
                                  <button
                                    className="file-name"
                                    aria-label={"Inspect " + f.name}
                                    onClick={() => setSelected(f.id)}
                                  >
                                    <FileIcon entry={f} />
                                    <span>
                                      {f.name}
                                      <small>
                                        {search
                                          ? (rootEntries.find(
                                              (p) => p.id === f.parentId,
                                            )?.name ?? "My files")
                                          : f.version > 1
                                            ? f.version + " versions"
                                            : "File"}
                                      </small>
                                    </span>
                                  </button>
                                </td>
                                <td className="date-column">
                                  {day(f.updatedAt)}
                                </td>
                                <td>{bytes(f.sizeBytes)}</td>
                                <td>
                                  <button
                                    className="icon-button"
                                    aria-label={"Details for " + f.name}
                                    onClick={() => setSelected(f.id)}
                                  >
                                    <MoreHorizontal size={19} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="empty-state compact">
                        <Files size={32} />
                        <h3>
                          {search
                            ? "No matching files"
                            : tab === "trash"
                              ? "No trashed files"
                              : "Room for something new"}
                        </h3>
                        <p>
                          {search
                            ? "Try another name."
                            : isSample
                              ? "Explore another folder to find sample files."
                              : "Upload a file or create a folder to get started."}
                        </p>
                      </div>
                    )}
                  </section>
                  <div className="library-footer">
                    <ShieldCheck size={15} />
                    <span>
                      {isSample
                        ? "Original public sample content. No private files."
                        : "Encrypted blocks at rest. Every accepted revision preserved."}
                    </span>
                    <a href={guide} target="_blank" rel="noreferrer">
                      See how it works <ArrowUpRight size={13} />
                    </a>
                  </div>
                </div>
                {entry && (
                  <aside className="inspector" aria-label="File details">
                    <div className="inspector-top">
                      <span>File details</span>
                      <button
                        className="icon-button"
                        aria-label="Close file details"
                        onClick={() => setSelected("")}
                      >
                        <X size={18} />
                      </button>
                    </div>
                    <div className="file-portrait">
                      <FileIcon entry={entry} large />
                      <span>{entry.name.split(".").pop()?.toUpperCase()}</span>
                    </div>
                    <h2>{entry.name}</h2>
                    <p className="inspector-meta">
                      {entry.folder ? "Folder" : bytes(entry.sizeBytes)}{" "}
                      <span>·</span> {day(entry.updatedAt)}
                    </p>
                    <div className="inspector-buttons">
                      {!entry.folder && (
                        <button
                          className="primary-button"
                          onClick={() => void download(entry)}
                          disabled={!isSample && !available}
                        >
                          <Download size={16} /> Download
                        </button>
                      )}
                      <button
                        className={"quiet-button " + (history ? "pressed" : "")}
                        onClick={() => setHistory(!history)}
                        disabled={entry.folder}
                      >
                        <History size={17} /> Version history
                      </button>
                    </div>
                    {history ? (
                      <section className="revision-list">
                        <h3>{revisions.length} revisions</h3>
                        {revisions.map((r, i) => (
                          <div className="revision" key={r.id}>
                            <span className="revision-dot" />
                            <div>
                              <strong>
                                Revision {revisions.length - i}
                                {i === 0 && <small>Current</small>}
                              </strong>
                              <p>
                                {day(r.createdAt)} · {r.author} ·{" "}
                                {bytes(r.sizeBytes)}
                              </p>
                            </div>
                            <button
                              className="icon-button"
                              aria-label={
                                "Download revision " + (revisions.length - i)
                              }
                              onClick={() => void download(entry, r)}
                              disabled={!isSample && !available}
                            >
                              <Download size={16} />
                            </button>
                          </div>
                        ))}
                      </section>
                    ) : (
                      <>
                        {preview && (
                          <section className="text-preview">
                            <h3>Preview</h3>
                            <pre>{preview.slice(0, 1800)}</pre>
                          </section>
                        )}
                        <dl className="file-facts">
                          <div>
                            <dt>Location</dt>
                            <dd>
                              {rootEntries.find((e) => e.id === entry.parentId)
                                ?.name ?? "My files"}
                            </dd>
                          </div>
                          <div>
                            <dt>Revision</dt>
                            <dd>{entry.version}</dd>
                          </div>
                          <div>
                            <dt>Access</dt>
                            <dd>
                              {isSample ? "Public sample" : snapshot.role}
                            </dd>
                          </div>
                        </dl>
                      </>
                    )}
                    {!isSample && canWrite && (
                      <div className="file-tools">
                        {entry.deleted ? (
                          <>
                            <button
                              className="quiet-button"
                              disabled={!available || !!busy}
                              onClick={() =>
                                setConfirm({ entry, action: "restore" })
                              }
                            >
                              <CornerDownRight size={16} /> Restore
                            </button>
                            {snapshot.role === "owner" && (
                              <button
                                className="danger-button"
                                disabled={!available || !!busy}
                                onClick={() =>
                                  setConfirm({ entry, action: "purge" })
                                }
                              >
                                Permanently purge
                              </button>
                            )}
                          </>
                        ) : (
                          <>
                            {!entry.folder && textFile(entry.name) && (
                              <button
                                className="quiet-button"
                                onClick={() => void openEditor()}
                                disabled={!!busy || (!available && !preview)}
                              >
                                <Edit3 size={16} /> Edit text
                              </button>
                            )}
                            {!entry.folder && (
                              <button
                                className="quiet-button"
                                disabled={!!busy}
                                onClick={() => {
                                  replace.current = entry;
                                  input.current?.click();
                                }}
                              >
                                <Upload size={16} /> Replace file
                              </button>
                            )}
                            <button
                              className="quiet-button"
                              disabled={!available || !!busy}
                              onClick={() => {
                                setFormName(entry.name);
                                setFormParent(entry.parentId);
                                setModal("rename");
                              }}
                            >
                              Rename or move
                            </button>
                            <button
                              className="danger-button"
                              disabled={!available || !!busy}
                              onClick={() =>
                                setConfirm({ entry, action: "trash" })
                              }
                            >
                              <Trash2 size={15} /> Move to trash
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </aside>
                )}
              </div>
            </>
          )}
        </main>
        <footer className="page-footer">
          <span>
            Commonplace is an independent architecture learning project.
          </span>
          <a href={guide} target="_blank" rel="noreferrer">
            Built to be understood <ArrowUpRight size={13} />
          </a>
        </footer>
      </div>
      <input
        className="sr-only"
        ref={input}
        type="file"
        aria-label="Choose file to upload"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file, replace.current);
          e.target.value = "";
        }}
      />
      {["namespace", "folder", "rename", "share"].includes(modal) && (
        <Modal
          title={
            modal === "namespace"
              ? "Create namespace"
              : modal === "folder"
                ? "New folder"
                : modal === "rename"
                  ? "Rename or move"
                  : "Share this namespace"
          }
          onClose={() => setModal("")}
        >
          <form onSubmit={submit}>
            {modal === "share" ? (
              <>
                <p className="form-help">
                  Access applies to every file and retained revision in this
                  namespace.
                </p>
                <ul className="member-list">
                  {members.map((m) => (
                    <li key={m.userId}>
                      <span>{m.userId}</span>
                      <strong>{m.role}</strong>
                    </li>
                  ))}
                </ul>
                <label>
                  Local user
                  <select
                    value={shareUser}
                    onChange={(e) => setShareUser(e.target.value)}
                  >
                    {["alice", "bob", "eve"].map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Permission
                  <select
                    value={shareRole}
                    onChange={(e) => setShareRole(e.target.value)}
                  >
                    <option value="reader">Reader — browse and download</option>
                    <option value="writer">
                      Writer — upload and change files
                    </option>
                    <option value="none">Remove access</option>
                  </select>
                </label>
              </>
            ) : (
              <>
                <label>
                  Name
                  <input
                    autoFocus
                    required
                    maxLength={200}
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                  />
                </label>
                {modal === "rename" && (
                  <label>
                    Destination folder
                    <select
                      value={formParent}
                      onChange={(e) => setFormParent(e.target.value)}
                    >
                      <option value="">My files</option>
                      {rootEntries
                        .filter(
                          (f) => f.folder && !f.deleted && f.id !== entry?.id,
                        )
                        .map((f) => (
                          <option value={f.id} key={f.id}>
                            {f.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button type="button" onClick={() => setModal("")}>
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={!!busy}
                type="submit"
              >
                {modal === "share"
                  ? "Save permission"
                  : modal === "rename"
                    ? "Save changes"
                    : "Create"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {editor && (
        <Modal
          title={"Edit " + editor.entry.name}
          onClose={() => setEditor(null)}
        >
          <form onSubmit={saveDraft}>
            <p className="form-help">
              Based on version {editor.entry.version}. Offline drafts stay in
              this browser. Concurrent edits become conflict copies.
            </p>
            <label>
              File contents
              <textarea
                aria-label="File contents"
                rows={12}
                value={editor.text}
                onChange={(e) => setEditor({ ...editor, text: e.target.value })}
              />
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button type="button" onClick={() => setEditor(null)}>
                Cancel
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={!!busy}
              >
                {available ? "Save revision" : "Save offline draft"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {confirm && (
        <Modal
          title={
            confirm.action === "purge"
              ? "Permanently purge this item?"
              : confirm.action === "restore"
                ? "Restore this item?"
                : "Move this item to trash?"
          }
          onClose={() => setConfirm(null)}
        >
          <p>
            {confirm.action === "purge"
              ? "All retained revisions will be permanently removed. Unreferenced blocks become eligible for garbage collection."
              : confirm.action === "trash"
                ? "Revisions stay available and continue to consume quota. You can restore this item later."
                : "The parent folder must be active and its name available."}
          </p>
          <strong>{confirm.entry.name}</strong>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button onClick={() => setConfirm(null)}>Cancel</button>
            <button
              className={
                confirm.action === "purge" ? "danger-button" : "primary-button"
              }
              disabled={!!busy}
              onClick={() =>
                void action(
                  () =>
                    api(
                      token,
                      `/entries/${confirm.entry.id}/${confirm.action}`,
                      "POST",
                      { version: confirm.entry.version },
                      crypto.randomUUID(),
                    ),
                  "Item " + confirm.action + " completed.",
                )
              }
            >
              {confirm.action === "purge"
                ? "Permanently purge"
                : confirm.action === "trash"
                  ? "Move to trash"
                  : "Restore"}
            </button>
          </div>
        </Modal>
      )}
      {modal === "account" && (
        <Modal title="Local account" onClose={() => setModal("")}>
          <p className="form-help">
            Public teaching credentials. Keep the server on loopback; configure
            independent tokens before changing its trust boundary.
          </p>
          <label>
            Identity
            <select
              value={accountUser}
              onChange={(e) => {
                const u = e.target.value;
                setAccountUser(u);
                setAccountToken(
                  localStorage.getItem("cp-token-" + u) ??
                    "local-" + u + "-key",
                );
              }}
            >
              {["alice", "bob", "eve"].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </label>
          <label>
            Access token
            <input
              type="password"
              autoComplete="off"
              value={accountToken}
              onChange={(e) => setAccountToken(e.target.value)}
            />
          </label>
          <div className="form-actions">
            <button
              className="primary-button"
              onClick={() => {
                localStorage.setItem("cp-token-" + accountUser, accountToken);
                localStorage.setItem("cp-user", accountUser);
                ns.current = localStorage.getItem("cp-ns-" + accountUser) ?? "";
                setSnapshot(null);
                setSelected("");
                setEvents([]);
                setUser(accountUser);
                setToken(accountToken);
                setModal("");
              }}
            >
              Use account
            </button>
          </div>
        </Modal>
      )}
      {modal.startsWith("discard:") && (
        <Modal
          title="Discard this pending session?"
          onClose={() => setModal("")}
        >
          <p>
            Export any saved text draft first. This removes the pending
            operation from this browser and cancels its server reservation when
            reachable.
          </p>
          <div className="form-actions">
            <button onClick={() => setModal("")}>Keep session</button>
            <button
              className="danger-button"
              onClick={() =>
                void (async () => {
                  const id = modal.slice(8),
                    j = jobs.find((x) => x.id === id);
                  if (!j) return;
                  try {
                    if (j.session && available) {
                      try {
                        await api(token, "/uploads/" + j.session, "DELETE");
                      } catch {
                        setNotice(
                          "Local session discarded. Any unreachable server reservation expires after 24 hours.",
                        );
                      }
                    }
                    await disk.remove("job:" + user + ":" + id);
                    await jobsRefresh();
                    setModal("");
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                })()
              }
            >
              Discard session
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
