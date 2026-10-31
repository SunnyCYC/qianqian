/* 啟動：選帳本 → 打開 → 資產總覽／每月收支。 */

import * as store from "./store.js";
import { currentSession, useSession } from "./api.js";
import { daysBetween, localDate } from "./core/dates.js";
import { hasData } from "./core/ledger.js";
import { renderFinance } from "./ui/assets.js";
import * as ledgers from "./ui/ledgers.js";
import { el, popupMenu, toast } from "./util.js";

// 有密碼的帳本放著不動這麼久就自動鎖上，免得離開座位時被別人看到
const IDLE_LOCK_MS = 15 * 60 * 1000;
const BACKUP_REMIND_DAYS = 30;

const main = document.getElementById("main");
const notice = document.getElementById("notice");
const footer = document.getElementById("footer");
// 按「這次先不要」只關到下次打開這本帳本，不記住，免得一直沒備份也沒人提醒
const snoozed = new Set();
const ledgerBtn = document.getElementById("ledger-btn");
const installBtn = document.getElementById("install-btn");

function showPicker() {
  useSession(null);
  ledgerBtn.hidden = true;
  footer.replaceChildren();
  notice.replaceChildren();
  ledgers.renderPicker(main, open);
}

async function open(session) {
  useSession(session);
  snoozed.delete(session.id);
  // 每次打開都再請一次：瀏覽器常在網站用久了、或安裝到桌面後才答應
  store.requestPersistence();
  ledgerBtn.hidden = false;
  ledgerBtn.textContent = `${session.name} ▾`;
  await refresh();
}

async function refresh() {
  const session = currentSession();
  if (!session) return;
  ledgerBtn.textContent = `${session.name} ▾`;
  try {
    await renderFinance(main);
  } catch (err) {
    toast(err.message, true);
    console.error(err);
  }
  renderFooter(session);
}

function backupState(session) {
  const last = session.record.backed_up_at;
  // backed_up_at 是 UTC 時間戳，要換成本地日期再比，否則台灣凌晨備份會顯示「1 天前」
  const days = last ? daysBetween(localDate(new Date(last)), localDate()) : null;
  const remind = hasData(session.doc) && (days === null || days > BACKUP_REMIND_DAYS);
  const text = last ? (days === 0 ? "今天" : `${days} 天前`) : "還沒備份過";
  return { days, remind, text };
}

function renderNotice(session) {
  const { days, remind } = backupState(session);
  if (!remind || snoozed.has(session.id)) {
    notice.replaceChildren();
    return;
  }
  notice.replaceChildren(
    el(
      "div",
      { class: "backup-notice" },
      el(
        "div",
        { class: "backup-notice-text" },
        el("strong", {}, days === null ? "這本帳本還沒備份過" : `已經 ${days} 天沒備份了`),
        el(
          "span",
          {},
          "資料只存在這台電腦的瀏覽器裡，清除瀏覽資料或換電腦就會不見。",
          "備份檔建議放進 Google Drive 或 OneDrive。"
        )
      ),
      el(
        "button",
        { class: "btn btn-sm btn-primary", type: "button", onclick: () => ledgers.exportBackup(session, refresh) },
        "現在備份"
      ),
      el(
        "button",
        {
          class: "btn btn-sm",
          type: "button",
          onclick: () => {
            snoozed.add(session.id);
            notice.replaceChildren();
          },
        },
        "這次先不要"
      )
    )
  );
}

function renderFooter(session) {
  renderNotice(session);
  const { remind, text } = backupState(session);
  footer.replaceChildren(
    el(
      "div",
      { class: "app-footer" },
      "資料只存在這台電腦的瀏覽器裡，不會上傳。",
      el("span", { class: remind ? "warn" : "" }, `上次備份：${text}`),
      "　",
      el(
        "button",
        { class: "link-btn", type: "button", onclick: () => ledgers.exportBackup(session, refresh) },
        "匯出備份"
      )
    )
  );
}

ledgerBtn.addEventListener("click", () => {
  const session = currentSession();
  if (!session) return;
  popupMenu(ledgerBtn, [
    ["切換帳本", showPicker],
    ["改帳本名稱", () => ledgers.renameLedger(session, refresh)],
    [session.locked ? "更換或移除密碼" : "設定密碼", () => ledgers.changePassword(session, refresh)],
    "sep",
    ["匯出備份", () => ledgers.exportBackup(session, refresh)],
    ["從備份還原", () => ledgers.restoreBackup(open)],
    "sep",
    ["刪除這本帳本", () => ledgers.deleteLedger(session, showPicker), { danger: true }],
  ]);
});

/* --- 別的視窗改了同一本 --------------------------------------------- */

store.onLedgerChanged(async ({ id }) => {
  const session = currentSession();
  if (!session || session.id !== id) return;
  try {
    if (await session.reload()) {
      document.querySelector(".modal-backdrop")?.remove();
      await refresh();
      return;
    }
  } catch {
    // 另一個視窗換了密碼
  }
  toast("這本帳本在別的視窗被更改了，請重新打開");
  showPicker();
});

/* --- 自動鎖 ------------------------------------------------------------ */

let idleTimer = null;
function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (currentSession()?.locked) {
      document.querySelectorAll(".modal-backdrop, .popover").forEach((n) => n.remove());
      showPicker();
      toast("太久沒動作，已自動鎖上");
    }
  }, IDLE_LOCK_MS);
}
["mousedown", "keydown", "touchstart", "wheel"].forEach((ev) =>
  document.addEventListener(ev, resetIdle, { passive: true })
);

/* --- 安裝成應用程式 --------------------------------------------------- */

let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installBtn.hidden = true;
});
window.addEventListener("appinstalled", () => {
  installBtn.hidden = true;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

/* --- 啟動 ------------------------------------------------------------ */

async function boot() {
  const all = await store.listLedgers();
  const lastId = await store.getMeta("last_ledger");
  const last = all.find((l) => l.id === lastId) || (all.length === 1 ? all[0] : null);
  // 上次用的帳本沒有密碼就直接打開；有密碼或不確定是誰，先問
  if (last && !last.locked) {
    try {
      return await open(await store.openLedger(last.id));
    } catch (err) {
      toast(err.message, true);
    }
  }
  showPicker();
}

boot().catch((err) => {
  main.replaceChildren(
    el(
      "div",
      { class: "empty-state" },
      el("h2", {}, "打不開資料"),
      el("p", {}, `${err.message || err}。如果是無痕視窗，請改用一般視窗。`)
    )
  );
});
