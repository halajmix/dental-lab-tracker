// IndexedDB store for photo blobs that were captured while offline. Unlike the
// mutation outbox (tiny JSON in localStorage), image blobs need IndexedDB.
//
// The trick that keeps this simple: a Supabase public-bucket URL is derived
// deterministically from the object PATH, so we compute the final URL the
// instant a photo is added — even offline — and embed it in the case/round
// right away. The blob just has to eventually land at that path; nothing about
// the case has to be patched afterwards. This store holds the blobs waiting to
// be uploaded; the uploader (data.js flushBlobUploads) drains it on reconnect.

const DB_NAME = "drcrown-uploads";
const STORE = "pending";
const listeners = new Set();

let dbPromise = null;
function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "path" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode) {
  return db().then((d) => d.transaction(STORE, mode).objectStore(STORE));
}

function notify() {
  countBlobs()
    .then((n) => listeners.forEach((cb) => cb(n)))
    .catch(() => {});
}

export function subscribeBlobs(cb) {
  listeners.add(cb);
  countBlobs()
    .then((n) => cb(n))
    .catch(() => cb(0));
  return () => listeners.delete(cb);
}

export async function putBlob(record) {
  // record: { path, bucket, blob, contentType }
  const store = await tx("readwrite");
  await new Promise((resolve, reject) => {
    const r = store.put({ ...record, createdAt: Date.now() });
    r.onsuccess = resolve;
    r.onerror = () => reject(r.error);
  });
  notify();
}

export async function allBlobs() {
  const store = await tx("readonly");
  return new Promise((resolve, reject) => {
    const r = store.getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}

export async function deleteBlob(path) {
  const store = await tx("readwrite");
  await new Promise((resolve, reject) => {
    const r = store.delete(path);
    r.onsuccess = resolve;
    r.onerror = () => reject(r.error);
  });
  notify();
}

export async function countBlobs() {
  try {
    const store = await tx("readonly");
    return await new Promise((resolve, reject) => {
      const r = store.count();
      r.onsuccess = () => resolve(r.result || 0);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return 0; // IndexedDB unavailable (private mode / old browser) -> report none
  }
}
