/* 慾望清單：打算花的錢，對照現有資產。
 *
 * 短中長期不存，依預計月份離今天多遠即時算，時間到了自己會往前移：
 *   短期：本月或下個月（含已經過了還沒買的）
 *   中期：六個月內
 *   長期：更遠，或還不確定
 *
 * 扣除是累積的——中期的計畫發生在短期之後，「扣完中期剩多少」必須先扣掉短期，
 * 否則會比實際寬裕。
 */

import { toMinor } from "./money.js";
import { localDate, monthOf, monthsBetween, parseMonth } from "./dates.js";
import { find, now, uid } from "./ledger.js";
import { overview } from "./assets.js";
import { summary as cashflowSummary } from "./cashflow.js";

export const BUCKETS = ["short", "mid", "long"];
// 中長期「若照每月可存累積」要估幾個月後
export const PROJECTION_MONTHS = { mid: 6, long: 12 };

const CASH_CLASS = "現金";
const CARD_CLASS = "信用卡未繳";

export const amountOf = (wish) => wish.lines.reduce((s, l) => s + l.amount_minor, 0);

export function bucket(wish, today) {
  if (!wish.target_month) return "long";
  const diff = monthsBetween(today, wish.target_month);
  if (diff <= 1) return "short";
  if (diff <= 6) return "mid";
  return "long";
}

function wishDict(doc, wish, today) {
  const cat = wish.category_id ? doc.categories.find((c) => c.id === wish.category_id) : null;
  return {
    id: wish.id,
    name: wish.name,
    category_id: wish.category_id,
    category: cat ? cat.name : null,
    target_month: wish.target_month,
    bucket: wish.status === "open" ? bucket(wish, today) : null,
    overdue: Boolean(wish.status === "open" && wish.target_month && monthsBetween(today, wish.target_month) < 0),
    status: wish.status,
    closed_on: wish.closed_on,
    note: wish.note,
    amount_minor: amountOf(wish),
    lines: wish.lines.map((l) => ({ label: l.label, amount_minor: l.amount_minor })),
  };
}

/** 可動用現金 = 現金 − 信用卡未繳。一個月內要花的錢不會去解定存或賣股票。 */
function liquid(ov) {
  const byName = Object.fromEntries(ov.classes.map((c) => [c.name, c.id]));
  const total = (name) => ov.class_totals[byName[name]] || 0;
  return total(CASH_CLASS) - total(CARD_CLASS);
}

export function summary(doc, today = localDate()) {
  const order = (a, b) => {
    if (!a.target_month !== !b.target_month) return a.target_month ? -1 : 1;
    return (a.target_month || "").localeCompare(b.target_month || "") || (a.created_at || "").localeCompare(b.created_at || "");
  };
  const wishes = [...doc.wishes].sort(order);
  const open = wishes.filter((w) => w.status === "open");

  const totals = { short: 0, mid: 0, long: 0 };
  for (const w of open) totals[bucket(w, today)] += amountOf(w);

  const ov = overview(doc, today);
  const net = ov.net_minor;
  const savings = cashflowSummary(doc, monthOf(today), today).savings_minor;
  const liquidMinor = liquid(ov);

  // 先用現金付，現金用完才動到定存、基金、股票
  let cash = liquidMinor;
  let other = net - liquidMinor;
  const start = { cash_minor: cash, other_minor: other };
  const breakdown = {};
  const remaining = {};
  const projected = {};
  let running = 0;
  for (const b of BUCKETS) {
    running += totals[b];
    remaining[b] = net - running;
    const fromCash = Math.min(totals[b], Math.max(cash, 0));
    cash -= fromCash;
    other -= totals[b] - fromCash;
    breakdown[b] = { cash_minor: cash, other_minor: other };
    projected[b] = b in PROJECTION_MONTHS && savings > 0 ? net + savings * PROJECTION_MONTHS[b] - running : null;
  }

  return {
    today,
    items: open.map((w) => wishDict(doc, w, today)),
    closed: wishes.filter((w) => w.status !== "open").map((w) => wishDict(doc, w, today)),
    totals,
    net_minor: net,
    missing_rates: ov.missing_rates,
    liquid_minor: liquidMinor,
    remaining,
    start,
    breakdown,
    monthly_savings_minor: savings,
    projected,
    projection_months: PROJECTION_MONTHS,
  };
}

/* --- 寫入 ------------------------------------------------------------- */

function parseLines(raw) {
  const lines = (raw || []).map((r) => ({ label: String(r.label ?? "").trim(), amount_minor: toMinor(r.amount) }));
  if (!lines.length) throw new Error("至少要有一個價格");
  return lines;
}

function checkCategory(doc, id) {
  if (id === null || id === undefined || id === "") return null;
  const cat = doc.categories.find((c) => c.id === id);
  if (!cat || cat.kind !== "expense") throw new Error("類別需為支出類別");
  return cat.id;
}

const parseTarget = (text) => (text ? parseMonth(text) : null);

function cleanName(name) {
  const value = String(name ?? "").trim();
  if (!value) throw new Error("請填想買什麼");
  return value;
}

export function createWish(doc, data) {
  const wish = {
    id: uid(),
    name: cleanName(data.name),
    category_id: checkCategory(doc, data.category_id),
    target_month: parseTarget(data.target_month),
    status: "open",
    closed_on: null,
    note: data.note ?? null,
    lines: parseLines(data.lines),
    created_at: now(),
  };
  doc.wishes.push(wish);
  return wish;
}

export function updateWish(doc, id, data) {
  const wish = find(doc.wishes, id, "找不到這個項目");
  const next = {
    name: data.name !== undefined && data.name !== null ? cleanName(data.name) : wish.name,
    category_id: data.category_id !== undefined ? checkCategory(doc, data.category_id) : wish.category_id,
    target_month: data.target_month !== undefined ? parseTarget(data.target_month) : wish.target_month,
    note: data.note !== undefined ? data.note : wish.note,
    lines: data.lines ? parseLines(data.lines) : wish.lines,
  };
  Object.assign(wish, next);
  return wish;
}

export function closeWish(doc, id, status, on = localDate()) {
  if (status !== "bought" && status !== "dropped") throw new Error("只能標成「買了」或「不買了」");
  const wish = find(doc.wishes, id, "找不到這個項目");
  wish.status = status;
  wish.closed_on = on;
  return wish;
}

export function reopenWish(doc, id) {
  const wish = find(doc.wishes, id, "找不到這個項目");
  wish.status = "open";
  wish.closed_on = null;
  return wish;
}

export function deleteWish(doc, id) {
  find(doc.wishes, id, "找不到這個項目");
  doc.wishes = doc.wishes.filter((w) => w.id !== id);
}
