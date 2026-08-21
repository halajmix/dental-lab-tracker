// Durable offline write queue ("outbox"). A technician on a bad or absent
// connection taps "mark stage complete"; the mutation is stored here, applied
// optimistically to the UI, and replayed when the connection returns.
//
// Storage is localStorage — the ops are tiny JSON (a stage target, a field
// value), it survives app restarts and PWA relaunches, and it's synchronous
// and dead-simple, which matters more than capacity for a write queue. (Queued
// photo BLOB uploads, which need IndexedDB, are a separate follow-up.)
//
// The conflict rule lives where it belongs — in how each op is APPLIED, not
// here: stage changes go through the atomic monotonic-merge RPC
// (case_apply_stage), field edits are last-writer-wins with a server rejection
// surfaced as a failed op. This module only owns durability + ordering (FIFO).

const KEY = "drcrown.outbox.v1";
const listeners = new Set();

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(ops) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ops));
  } catch {
    /* storage full / disabled — nothing safe to do here */
  }
  for (const cb of listeners) {
    try {
      cb(ops);
    } catch {
      /* a bad listener must not break the queue */
    }
  }
}

export function subscribe(cb) {
  listeners.add(cb);
  cb(read());
  return () => listeners.delete(cb);
}

export function getOps() {
  return read();
}
export function pendingCount() {
  return read().filter((o) => o.status !== "failed").length;
}
export function failedCount() {
  return read().filter((o) => o.status === "failed").length;
}

// Add a mutation to the queue. `op` carries everything needed to replay it:
//   { kind: "stage", caseId, target, direction, entry, label }
//   { kind: "patch", caseId, patch, label }
export function enqueue(op) {
  const full = {
    id: `ob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    status: "pending",
    ...op,
  };
  const ops = read();
  ops.push(full);
  write(ops);
  return full;
}

function update(id, patch) {
  const ops = read().map((o) => (o.id === id ? { ...o, ...patch } : o));
  write(ops);
}
export function removeOp(id) {
  write(read().filter((o) => o.id !== id));
}
export function retryFailed() {
  write(read().map((o) => (o.status === "failed" ? { ...o, status: "pending", error: null } : o)));
}
export function discardFailed() {
  write(read().filter((o) => o.status !== "failed"));
}

// Best-effort classifier: a thrown fetch/network failure (offline, DNS, TLS,
// timeout) means "try again later — keep it queued". Anything else (a 4xx from
// PostgREST, an RLS/guard rejection) means "the server refused this — surface
// it", so we don't retry a guaranteed-reject forever.
export function isNetworkError(err) {
  if (!err) return false;
  if (err.isNetwork) return true;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const m = String(err.message || err).toLowerCase();
  return (
    err.name === "TypeError" &&
    (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("load failed") || m.includes("network request failed"))
  );
}

let flushing = false;

// Replay pending ops in FIFO order, one at a time (so a case's queued sequence
// applies in order). `apply(op)` performs the real DB call and returns the
// updated case row, or throws. A network error stops the flush and leaves the
// rest pending; any other error marks THAT op failed and moves on. Returns
// { synced:[{op,row}], failed:[op], offline:bool }.
export async function flush(apply) {
  if (flushing) return { synced: [], failed: [], offline: false, busy: true };
  flushing = true;
  const synced = [];
  const failed = [];
  let offline = false;
  try {
    // Snapshot pending ids up front; new enqueues during a flush wait for the
    // next run rather than extending this one.
    const pending = read().filter((o) => o.status !== "failed");
    for (const op of pending) {
      try {
        const row = await apply(op);
        removeOp(op.id);
        synced.push({ op, row });
      } catch (err) {
        if (isNetworkError(err)) {
          offline = true;
          break; // still offline — keep this and the rest pending
        }
        update(op.id, { status: "failed", error: String(err?.message || err).slice(0, 300) });
        failed.push(op);
      }
    }
  } finally {
    flushing = false;
  }
  return { synced, failed, offline };
}
