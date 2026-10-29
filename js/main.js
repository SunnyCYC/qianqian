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
const footer = document.getElementById("footer");
const ledgerBtn = document.getElementById("ledger-btn");
const installBtn = document.getElementById("install-btn");

function showPicker() {
  useSession(null);
  ledgerBtn.hidden = true;
  footer.replaceChildren();
  ledgers.renderPicker(main, open);
}

async function open(session) {
  useSession(session);
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

function renderFooter(session) {
  const last = session.record.backed_up_at;
  const days = last ? daysBetween(last.slice(0, 10), localDate()) : null;
  const remind = hasData(session.doc) && (days === null || days > BACKUP_REMIND_DAYS);
  const text = last ? (days === 0 ? "今天" : `${days} 天前`) : "還沒備份過";
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
