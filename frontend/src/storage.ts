const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("commonplace-v1", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("records");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
export async function read<T>(key: string): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("records");
    const r = tx.objectStore("records").get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => db.close();
  });
}
export async function write(key: string, value: unknown) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("records", "readwrite");
    tx.objectStore("records").put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function remove(key: string) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("records", "readwrite");
    tx.objectStore("records").delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function all<T>(prefix: string): Promise<T[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("records"),
      store = tx.objectStore("records");
    const keys = store.getAllKeys(IDBKeyRange.bound(prefix, prefix + "\uffff")),
      values = store.getAll(IDBKeyRange.bound(prefix, prefix + "\uffff"));
    tx.oncomplete = () => {
      db.close();
      resolve(values.result);
    };
    tx.onerror = () => reject(keys.error || values.error);
  });
}
