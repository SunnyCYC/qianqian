import { describe, expect, test } from "./runner.js";
import * as store from "../js/store.js";
import { createAccount } from "../js/core/assets.js";

const TEST_DB = "qianqian-test";

async function fresh() {
  await store.useDatabase(TEST_DB);
  await store.dropDatabase(TEST_DB);
}

async function rejects(promise, pattern) {
  try {
    await promise;
  } catch (err) {
    if (pattern && !err.message.includes(pattern)) throw new Error(`錯誤訊息不含「${pattern}」：${err.message}`);
    return;
  }
  throw new Error("預期失敗，但成功了");
}

async function rawRecord(id) {
  const db = await new Promise((resolve) => {
    const req = indexedDB.open(TEST_DB);
    req.onsuccess = () => resolve(req.result);
  });
  const record = await new Promise((resolve) => {
    const req = db.transaction("ledgers").objectStore("ledgers").get(id);
    req.onsuccess = () => resolve(req.result);
  });
  db.close();
  return record;
}

describe("帳本保存", () => {
  test("沒密碼的帳本直接打開", async () => {
    await fresh();
    const s = await store.createLedger("媽媽");
    createAccount(s.doc, { name: "郵局" });
    await s.save();
    const again = await store.openLedger(s.id);
    expect(again.doc.accounts[0].name).toBe("郵局");
    expect(again.locked).toBe(false);
  });

  test("有密碼的帳本：裝置上看不到內容，密碼錯打不開", async () => {
    await fresh();
    const s = await store.createLedger("小明", "secret-1");
    createAccount(s.doc, { name: "秘密帳戶" });
    await s.save();
    const raw = await rawRecord(s.id);
    expect(raw.data).toBe(undefined);
    expect(JSON.stringify(raw).includes("秘密帳戶")).toBe(false);
    await rejects(store.openLedger(s.id, "wrong"), "密碼不對");
    await rejects(store.openLedger(s.id), "有密碼");
    const again = await store.openLedger(s.id, "secret-1");
    expect(again.doc.accounts[0].name).toBe("秘密帳戶");
  });

  test("移除密碼後不必輸入，再設定又要", async () => {
    await fresh();
    const s = await store.createLedger("小華", "abcd");
    await s.setPassword(null);
    expect((await store.listLedgers())[0].locked).toBe(false);
    await store.openLedger(s.id);
    await s.setPassword("efgh");
    await rejects(store.openLedger(s.id, "abcd"), "密碼不對");
    await store.openLedger(s.id, "efgh");
  });

  test("帳本名稱不能重複", async () => {
    await fresh();
    await store.createLedger("爸爸");
    await rejects(store.createLedger("爸爸"), "已經有");
  });

  test("備份還原：另存一本或取代", async () => {
    await fresh();
    const s = await store.createLedger("姊姊", "pw12");
    createAccount(s.doc, { name: "A" });
    await s.save();
    const text = await s.exportBackup();
    expect(text.includes('"A"')).toBe(false);

    createAccount(s.doc, { name: "B" });
    await s.save();

    const backup = await store.readBackup(text);
    expect(backup.existing.name).toBe("姊姊");
    const copy = await store.importBackup(backup.record, { replace: false });
    expect(copy.name).toBe("姊姊（還原）");
    expect((await store.openLedger(copy.id, "pw12")).doc.accounts.length).toBe(1);

    await store.importBackup(backup.record, { replace: true });
    expect((await store.openLedger(s.id, "pw12")).doc.accounts.map((a) => a.name)).toEqual(["A"]);
    expect((await store.listLedgers()).length).toBe(2);
  });

  test("不是備份檔就說清楚", async () => {
    await fresh();
    await rejects(store.readBackup("hello"), "不是錢錢去哪兒的備份檔");
    await rejects(store.readBackup('{"format":"other"}'), "不是錢錢去哪兒的備份檔");
  });

  test("刪除帳本", async () => {
    await fresh();
    const s = await store.createLedger("弟弟");
    await store.deleteLedger(s.id);
    expect((await store.listLedgers()).length).toBe(0);
    await store.useDatabase("qianqian-test-done");
    await store.dropDatabase(TEST_DB);
  });
});
