/* 畫面用的資料介面。每個寫入都是：在帳本上改 → 整本存回裝置。
 *
 * 寫入函式先驗證、全部通過才動帳本，所以出錯時帳本保持原樣；
 * 存檔本身失敗則重新載入，避免畫面上的資料跟裝置上的不一致。
 */

import * as assets from "./core/assets.js";
import * as cashflow from "./core/cashflow.js";
import * as wishlist from "./core/wishlist.js";
import { localDate, monthOf } from "./core/dates.js";

const RATE_API = "https://open.er-api.com/v6/latest/";

let session = null;

export function useSession(s) {
  session = s;
}

export const currentSession = () => session;

function doc() {
  if (!session) throw new Error("還沒有打開帳本");
  return session.doc;
}

async function write(fn) {
  const before = JSON.stringify(session.doc);
  const result = fn(doc());
  try {
    await session.save();
  } catch (err) {
    session.doc = JSON.parse(before);
    throw new Error(`存檔失敗：${err.message || err}`);
  }
  return result;
}

/** 抓「1 外幣 = ? 台幣」，是每日一次的中間價，不是銀行牌告的買賣價。永遠不丟例外。 */
async function liveRates() {
  const base = doc().base_currency;
  const currencies = assets.foreignCurrencies(doc());
  if (!currencies.length) return { base, rates: {}, error: null };
  try {
    const resp = await fetch(RATE_API + base, { cache: "no-store" });
    const payload = await resp.json();
    if (payload.result !== "success") throw new Error(payload["error-type"] || "匯率服務回應異常");
    const asOf = payload.time_last_update_unix
      ? new Date(payload.time_last_update_unix * 1000).toISOString().slice(0, 10)
      : localDate();
    const rates = {};
    for (const cur of currencies) {
      const perBase = payload.rates?.[cur];
      // API 給的是 1 台幣 = x 外幣，要反過來
      if (perBase) rates[cur] = { rate: (1 / perBase).toFixed(4), as_of: asOf };
    }
    const lost = currencies.filter((c) => !rates[c]);
    return { base, rates, error: lost.length ? `這些幣別抓不到：${lost.join("、")}，請直接填。` : null };
  } catch {
    return { base, rates: {}, error: "抓不到匯率（可能沒有網路），請直接填。" };
  }
}

export const api = {
  financeOverview: async (on) => assets.overview(doc(), on || localDate()),
  financeHistory: async () => assets.history(doc()),
  liveRates,
  createFinanceAccount: (body) => write((d) => assets.createAccount(d, body)),
  updateFinanceAccount: (id, body) => write((d) => assets.updateAccount(d, id, body)),
  closeFinanceAccount: (id, on) => write((d) => assets.closeAccount(d, id, on || localDate())),
  saveFinanceSnapshot: (body) => write((d) => assets.saveSnapshot(d, body)),

  cashflowCategories: async () => cashflow.categories(doc()).map(({ id, name, kind }) => ({ id, name, kind })),
  cashflow: async (month) => cashflow.summary(doc(), month || monthOf(localDate())),
  createCashflowItem: (body) => write((d) => cashflow.createItem(d, body)),
  updateCashflowItem: (id, body) => write((d) => cashflow.updateItem(d, id, body)),
  adjustCashflowItem: (id, body) => write((d) => cashflow.adjustItem(d, id, body)),
  stopCashflowItem: (id, lastMonth) => write((d) => cashflow.stopItem(d, id, lastMonth)),
  deleteCashflowItem: (id) => write((d) => cashflow.deleteItem(d, id)),
  saveCashflowBudgets: (body) => write((d) => cashflow.saveBudgets(d, body)),

  wishlist: async () => wishlist.summary(doc()),
  createWish: (body) => write((d) => wishlist.createWish(d, body)),
  updateWish: (id, body) => write((d) => wishlist.updateWish(d, id, body)),
  closeWish: (id, status) => write((d) => wishlist.closeWish(d, id, status)),
  reopenWish: (id) => write((d) => wishlist.reopenWish(d, id)),
  deleteWish: (id) => write((d) => wishlist.deleteWish(d, id)),
};
