/* 帳本的保存：瀏覽器的 IndexedDB，只存在這台裝置上，不會上傳。
 *
 * 一本帳本一筆紀錄。沒設密碼的帳本直接存 JSON；設了密碼的整份用 AES-GCM 加密，
 * 金鑰由密碼經 PBKDF2 推導，只留在記憶體裡。帳本名稱不加密——選帳本的畫面要顯示。
 *
 * 忘記密碼就打不開，沒有後門。這是「手足之間保有隱私」的代價，設定密碼時要講清楚。
 */

import { LEDGER_VERSION, newLedger, now, uid } from "./core/ledger.js";

let dbName = "qianqian";
const STORE = "ledgers";
const META = "meta";
const PBKDF2_ITERATIONS = 600_000;
export const BACKUP_FORMAT = "qianqian-backup";

let dbPromise = null;

const channel = "BroadcastChannel" in self ? new BroadcastChannel("qianqian") : null;

/** 別的視窗存了某本帳本時通知（同一台裝置、同一個瀏覽器）。 */
export function onLedgerChanged(handler) {
  channel?.addEventListener("message", (e) => handler(e.data));
}

/** 測試用：換一個資料庫，免得動到真正的帳本。 */
export async function useDatabase(name) {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
  dbName = name;
}

export function dropDatabase(name) {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
      req.result.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const req = fn(t.objectStore(storeName));
    t.oncomplete = () => resolve(req instanceof IDBRequest ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("存檔失敗"));
  });
}

const getRecord = (id) => tx(STORE, "readonly", (s) => s.get(id));
const putRecord = (record) => tx(STORE, "readwrite", (s) => s.put(record));

export async function getMeta(key) {
  return tx(META, "readonly", (s) => s.get(key));
}

export async function setMeta(key, value) {
  return tx(META, "readwrite", (s) => s.put(value, key));
}

/** 請瀏覽器不要在空間不足時自動清掉資料。使用者沒同意也不影響使用。 */
export async function requestPersistence() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/* --- 加密 ------------------------------------------------------------- */

const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encrypt(key, doc) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(doc)));
  return { iv: toB64(iv), cipher: toB64(cipher) };
}

async function decrypt(key, record) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(record.iv) }, key, fromB64(record.cipher));
  return JSON.parse(dec.decode(plain));
}

/* --- 帳本 ------------------------------------------------------------- */

const summaryOf = (r) => ({
  id: r.id,
  name: r.name,
  locked: Boolean(r.cipher),
  created_at: r.created_at,
  updated_at: r.updated_at,
  backed_up_at: r.backed_up_at || null,
});

export async function listLedgers() {
  const all = await tx(STORE, "readonly", (s) => s.getAll());
  return all.map(summaryOf).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function cleanName(name) {
  const value = String(name ?? "").trim();
  if (!value) throw new Error("請幫帳本取個名字");
  return value;
}

async function checkUniqueName(name, exceptId = null) {
  const all = await listLedgers();
  if (all.some((l) => l.name === name && l.id !== exceptId)) throw new Error(`已經有叫「${name}」的帳本`);
}

/**
 * 開著的帳本。doc 是解密後的內容，key 只在有密碼時存在。
 * 所有寫入都改 doc 再呼叫 save()。
 */
class Session {
  constructor(record, doc, key, salt) {
    this.id = record.id;
    this.name = record.name;
    this.record = record;
    this.doc = doc;
    this.key = key;
    this.salt = salt;
  }

  get locked() {
    return Boolean(this.key);
  }

  async save() {
    const record = { ...this.record, name: this.name, updated_at: now() };
    delete record.data;
    delete record.iv;
    delete record.cipher;
    delete record.salt;
    if (this.key) Object.assign(record, { salt: toB64(this.salt), ...(await encrypt(this.key, this.doc)) });
    else record.data = this.doc;
    await putRecord(record);
    this.record = record;
    channel?.postMessage({ id: this.id, updated_at: record.updated_at });
  }

  /** 別的視窗改了同一本帳本時，重新讀一次，免得這邊存檔時把那邊的修改蓋掉。 */
  async reload() {
    const record = await getRecord(this.id);
    if (!record) return false;
    if (record.cipher && !this.key) return false;
    this.doc = record.cipher ? await decrypt(this.key, record) : record.data;
    if (record.cipher) this.salt = fromB64(record.salt);
    this.name = record.name;
    this.record = record;
    return true;
  }

  async rename(name) {
    const value = cleanName(name);
    await checkUniqueName(value, this.id);
    this.name = value;
    await this.save();
  }

  /** 設定、更換或移除密碼（傳 null）。 */
  async setPassword(password) {
    if (password) {
      this.salt = crypto.getRandomValues(new Uint8Array(16));
      this.key = await deriveKey(password, this.salt);
    } else {
      this.key = null;
      this.salt = null;
    }
    await this.save();
  }

  /** 匯出的就是存在裝置上的那筆紀錄：有密碼的帳本，備份檔也是加密的。 */
  async exportBackup() {
    await this.save();
    const stamp = now();
    const { backed_up_at, ...record } = this.record;
    this.record = { ...this.record, backed_up_at: stamp };
    await putRecord(this.record);
    return JSON.stringify({ format: BACKUP_FORMAT, version: LEDGER_VERSION, exported_at: stamp, ledger: record });
  }
}

export async function createLedger(name, password = null) {
  const value = cleanName(name);
  await checkUniqueName(value);
  const stamp = now();
  const record = { id: uid(), name: value, created_at: stamp, updated_at: stamp };
  const session = new Session(record, newLedger(), null, null);
  if (password) await session.setPassword(password);
  else await session.save();
  await setMeta("last_ledger", record.id);
  return session;
}

export async function openLedger(id, password = null) {
  const record = await getRecord(id);
  if (!record) throw new Error("找不到這本帳本");
  let session;
  if (record.cipher) {
    if (!password) throw new Error("這本帳本有密碼");
    const salt = fromB64(record.salt);
    const key = await deriveKey(password, salt);
    let doc;
    try {
      doc = await decrypt(key, record);
    } catch {
      throw new Error("密碼不對");
    }
    session = new Session(record, doc, key, salt);
  } else {
    session = new Session(record, record.data, null, null);
  }
  await setMeta("last_ledger", id);
  return session;
}

export async function deleteLedger(id) {
  await tx(STORE, "readwrite", (s) => s.delete(id));
  if ((await getMeta("last_ledger")) === id) await setMeta("last_ledger", null);
}

/** 讀備份檔，回傳要匯入的紀錄與「同一本帳本是否已在這台裝置上」。 */
export async function readBackup(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("這不是錢錢去哪兒的備份檔");
  }
  const record = payload?.ledger;
  if (payload?.format !== BACKUP_FORMAT || !record?.id || !record?.name || !(record.data || record.cipher)) {
    throw new Error("這不是錢錢去哪兒的備份檔");
  }
  if ((payload.version || 1) > LEDGER_VERSION) throw new Error("這個備份來自較新的版本，請先更新程式");
  const existing = await getRecord(record.id);
  return { record, exportedAt: payload.exported_at, existing: existing ? summaryOf(existing) : null };
}

/** replace=false 時另存一本新的（換新 id，名字若重複就加上「（還原）」）。 */
export async function importBackup(record, { replace }) {
  let incoming = { ...record };
  if (!replace) {
    let name = incoming.name;
    const names = new Set((await listLedgers()).map((l) => l.name));
    while (names.has(name)) name = `${name}（還原）`;
    incoming = { ...incoming, id: uid(), name };
  }
  incoming.backed_up_at = now();
  await putRecord(incoming);
  return summaryOf(incoming);
}
