/**
 * 체험 모드의 목장보고서 PDF 보관함.
 * - 이 브라우저의 IndexedDB 에 경로(path) → PDF 바이트로 저장해요 (localStorage 는 너무 작아서).
 * - IndexedDB 를 못 쓰는 브라우저(사생활 보호 모드 등)는 메모리에만 둬요. 그러면 새로고침하면 파일이 사라져요.
 * - 바이트는 Blob 대신 ArrayBuffer 로 저장해요 (옛 사파리는 IndexedDB 에 Blob 을 못 넣는 일이 있어요).
 */

const DB_NAME = 'am-reports-demo'
const STORE = 'files'

/** IndexedDB 를 못 쓸 때 쓰는 메모리 보관함 (열기에 실패한 뒤에는 계속 여기만 써요) */
const memory = new Map<string, ArrayBuffer>()
let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null)
        return
      }
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => {
        const db = req.result
        // 다른 탭이 새 버전으로 열려고 하면 비켜 줘요
        db.onversionchange = () => db.close()
        resolve(db)
      }
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

/** 한 번의 IndexedDB 작업. 실패하면 null (부르는 쪽이 메모리로 대신해요) */
function run<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<{ value: T | undefined } | null> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode)
      let value: T | undefined
      const req = fn(tx.objectStore(STORE))
      if (req) req.onsuccess = () => (value = req.result)
      tx.oncomplete = () => resolve({ value })
      tx.onerror = () => resolve(null)
      tx.onabort = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/** 내 바이트만 가진 ArrayBuffer 로 복사 (Uint8Array 가 큰 버퍼의 일부일 수 있어서) */
function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}

/** 저장. 저장 공간이 모자라 IndexedDB 에 못 넣으면 메모리에라도 둬요. 메모리에만 뒀으면 false */
export async function putReportBlob(path: string, bytes: Uint8Array): Promise<boolean> {
  const buf = copyBuffer(bytes)
  const db = await openDb()
  if (db) {
    const ok = await run(db, 'readwrite', (s) => {
      s.put(buf, path)
    })
    if (ok) {
      memory.delete(path)
      return true
    }
  }
  memory.set(path, buf)
  return false
}

/** 읽기. 없으면 null */
export async function getReportBlob(path: string): Promise<Uint8Array | null> {
  const mem = memory.get(path)
  if (mem) return new Uint8Array(mem.slice(0))
  const db = await openDb()
  if (!db) return null
  const res = await run<unknown>(db, 'readonly', (s) => s.get(path))
  const v = res?.value
  if (v instanceof ArrayBuffer) return new Uint8Array(v)
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength))
  if (typeof Blob !== 'undefined' && v instanceof Blob) return new Uint8Array(await v.arrayBuffer())
  return null
}

/** 지우기 (없는 경로는 그냥 넘어가요. 실패해도 오류를 내지 않아요) */
export async function deleteReportBlobs(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  for (const p of paths) memory.delete(p)
  const db = await openDb()
  if (!db) return
  await run(db, 'readwrite', (s) => {
    for (const p of paths) s.delete(p)
  })
}

/** 저장된 모든 경로 (목록에 없는 파일 정리용) */
export async function listReportPaths(): Promise<string[]> {
  const out = new Set<string>(memory.keys())
  const db = await openDb()
  if (db) {
    const res = await run<IDBValidKey[]>(db, 'readonly', (s) => s.getAllKeys())
    for (const k of res?.value ?? []) if (typeof k === 'string') out.add(k)
  }
  return [...out]
}
