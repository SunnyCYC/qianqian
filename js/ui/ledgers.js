/* 帳本：選擇、新增、密碼、備份與還原、刪除。
 *
 * 密碼是選填的。父母的帳本通常不設，打開就能用；想保有隱私的人自己設。
 * 沒設密碼的帳本，用這台電腦的人都能打開——這點在建立時講清楚。
 */

import * as store from "../store.js";
import { localDate } from "../core/dates.js";
import { hasData } from "../core/ledger.js";
import { confirmBox, modal, selectField, textField } from "../dialog.js";
import { download, el, pickFile, toast } from "../util.js";

const FORGET_WARNING = "忘記密碼就再也打不開，沒有人救得回來。請記在安全的地方。";

function passwordFields(required = false) {
  const pass = textField(required ? "密碼" : "密碼（選填）", "", null, { type: "password", autocomplete: "new-password" });
  const again = textField("再輸入一次", "", null, { type: "password", autocomplete: "new-password" });
  const read = () => {
    const p = pass.input.value;
    if (!p && !again.input.value) {
      if (required) throw new Error("請輸入密碼");
      return null;
    }
    if (p !== again.input.value) throw new Error("兩次輸入的密碼不一樣");
    if (p.length < 4) throw new Error("密碼至少 4 個字");
    return p;
  };
  return { nodes: [pass.node, again.node], read };
}

/* --- 選帳本 ----------------------------------------------------------- */

export async function renderPicker(mount, onOpen) {
  const ledgers = await store.listLedgers();
  if (!ledgers.length) return renderWelcome(mount, onOpen);

  mount.replaceChildren(
    el(
      "div",
      { class: "picker" },
      el("h2", {}, "誰在用？"),
      el("p", {}, "每個人一本帳本，各記各的。"),
      el(
        "div",
        { class: "picker-list" },
        ...ledgers.map((l) =>
          el(
            "button",
            { class: "picker-item", type: "button", onclick: () => openLedger(l, onOpen) },
            el("span", {}, l.name),
            l.locked ? el("span", { class: "picker-lock" }, "有密碼") : null
          )
        )
      ),
      el(
        "div",
        { class: "picker-actions" },
        el("button", { class: "btn", type: "button", onclick: () => newLedger(onOpen) }, "+ 新帳本"),
        el("button", { class: "btn", type: "button", onclick: () => restoreBackup(onOpen) }, "從備份還原")
      )
    )
  );
}

function renderWelcome(mount, onOpen) {
  mount.replaceChildren(
    el(
      "div",
      { class: "picker" },
      el("h2", {}, "錢錢去哪兒"),
      el("p", {}, "盤點資產、估算每月收支、對照想買的東西。"),
      el(
        "div",
        { class: "picker-actions" },
        el("button", { class: "btn btn-primary", type: "button", onclick: () => newLedger(onOpen) }, "建立我的帳本"),
        el("button", { class: "btn", type: "button", onclick: () => restoreBackup(onOpen) }, "從備份還原")
      ),
      el(
        "p",
        { class: "picker-note" },
        "資料只存在這台電腦的瀏覽器裡，不會上傳到任何地方。",
        el("br"),
        "家裡共用一台電腦的話，每個人建一本自己的帳本。"
      )
    )
  );
}

async function openLedger(summary, onOpen) {
  if (!summary.locked) {
    try {
      onOpen(await store.openLedger(summary.id));
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }
  const pass = textField("密碼", "", null, { type: "password", autocomplete: "current-password" });
  modal({
    title: `打開「${summary.name}」`,
    fields: [pass.node],
    confirmLabel: "打開",
    onConfirm: async () => {
      if (!pass.input.value) throw new Error("請輸入密碼");
      onOpen(await store.openLedger(summary.id, pass.input.value));
    },
  });
}

function newLedger(onOpen) {
  const name = textField("帳本名稱", "", "通常就是你的名字，例如「媽媽」「小明」");
  const password = passwordFields(false);
  modal({
    title: "新帳本",
    fields: [
      name.node,
      ...password.nodes,
      el(
        "p",
        { class: "field-hint" },
        "不設密碼：用這台電腦的人都能打開。",
        el("br"),
        "設了密碼：別人打不開。", FORGET_WARNING
      ),
    ],
    confirmLabel: "建立",
    onConfirm: async () => {
      const session = await store.createLedger(name.input.value, password.read());
      store.requestPersistence();
      onOpen(session);
    },
  });
}

/* --- 帳本選單裡的動作 --------------------------------------------------- */

export function renameLedger(session, done) {
  const name = textField("帳本名稱", session.name);
  modal({
    title: "改帳本名稱",
    fields: [name.node],
    confirmLabel: "儲存",
    onConfirm: async () => {
      await session.rename(name.input.value);
      toast("已更新");
      done();
    },
  });
}

export function changePassword(session, done) {
  const password = passwordFields(!session.locked);
  const fields = [
    ...password.nodes,
    el("p", { class: "field-hint" }, FORGET_WARNING),
  ];
  modal({
    title: session.locked ? "更換密碼" : "設定密碼",
    fields: session.locked
      ? [...fields, el("p", { class: "field-hint" }, "兩格都留空就是移除密碼，之後打開不用再輸入。")]
      : fields,
    confirmLabel: "儲存",
    onConfirm: async () => {
      const value = password.read();
      if (!value && session.locked) {
        const ok = await confirmBox("移除密碼？", "移除後，用這台電腦的人都能打開這本帳本。", "移除密碼");
        if (!ok) return;
      }
      await session.setPassword(value);
      toast(value ? "已設定密碼" : "已移除密碼");
      done();
    },
  });
}

export async function exportBackup(session, done) {
  const text = await session.exportBackup();
  download(`錢錢去哪兒-${session.name}-${localDate()}.json`, text);
  toast(session.locked ? "已匯出（備份檔用同一組密碼加密）" : "已匯出");
  done();
}

export async function restoreBackup(onOpen) {
  const text = await pickFile();
  if (!text) return;
  let backup;
  try {
    backup = await store.readBackup(text);
  } catch (err) {
    toast(err.message, true);
    return;
  }
  const { record, exportedAt, existing } = backup;
  const when = exportedAt ? exportedAt.slice(0, 10) : "不明";
  const finish = async (replace) => {
    const summary = await store.importBackup(record, { replace });
    toast("已還原");
    if (summary.locked) await openLedger(summary, onOpen);
    else onOpen(await store.openLedger(summary.id));
  };

  if (!existing) {
    const ok = await confirmBox(
      `還原「${record.name}」？`,
      [`備份時間：${when}`, record.cipher ? "這份備份有密碼，打開時要輸入備份當時的密碼。" : null].filter(Boolean),
      "還原"
    );
    if (ok) await finish(false);
    return;
  }

  const how = selectField(
    "怎麼處理",
    [
      { value: "copy", label: "另存成一本新的（兩本都留著）" },
      { value: "replace", label: `用備份取代這台電腦上的「${existing.name}」` },
    ],
    "copy",
    "取代的話，這台電腦上這本帳本在備份之後的修改都會消失。"
  );
  modal({
    title: "這本帳本已經在這台電腦上",
    fields: [el("p", { class: "modal-text" }, `備份時間：${when}`), how.node],
    confirmLabel: "還原",
    onConfirm: () => finish(how.select.value === "replace"),
  });
}

export async function deleteLedger(session, done) {
  const lines = [
    "這本帳本的所有資料都會從這台電腦上刪掉，無法復原。",
    hasData(session.doc) ? "如果之後可能還要用，請先「匯出備份」。" : null,
  ].filter(Boolean);
  const name = textField(`確認：輸入帳本名稱「${session.name}」`, "");
  modal({
    title: `刪除「${session.name}」？`,
    fields: [...lines.map((l) => el("p", { class: "modal-text" }, l)), name.node],
    confirmLabel: "刪除",
    onConfirm: async () => {
      if (name.input.value.trim() !== session.name) throw new Error("名稱不符，沒有刪除");
      await store.deleteLedger(session.id);
      toast("已刪除");
      done();
    },
  });
}
