/* 資產盤點：「截至某日」的總覽、歷史、帳戶。
 *
 * 總覽的規則只有一條：每一格取該日或之前最近的一筆。只更新了證券戶的那天，
 * 其他帳戶沿用上次的數字，總額才不會假性暴跌。舊數字不藏起來，回傳它是哪天的。
 *
 * 匯率同理。找不到匯率的外幣帳戶不併入總額，而是列在 missing_rates——
 * 用 1:1 硬加會讓 200 歐元變成 200 台幣，錯得無聲無息。
 */

import { convert, microToString, toMicro, toMinor } from "./money.js";
import { daysBetween, parseDate } from "./dates.js";
import { find, now, uid } from "./ledger.js";

export const STALE_DAYS = 45;

const bySort = (a, b) => a.sort_order - b.sort_order || (a.created_at || "").localeCompare(b.created_at || "");

export function activeClasses(doc) {
  return doc.classes.filter((c) => c.is_active).sort(bySort);
}

export function sortedAccounts(doc) {
  return [...doc.accounts].sort(bySort);
}

/** 每個 (帳戶, 類別) 在 asOf 當天或之前最近的一筆。 */
function latestCells(doc, asOf) {
  const cells = new Map();
  for (const bal of doc.balances) {
    if (bal.as_of > asOf) continue;
    const key = `${bal.account_id}|${bal.class_id}`;
    const prev = cells.get(key);
    if (!prev || prev.as_of < bal.as_of) cells.set(key, bal);
  }
  return cells;
}

export function latestRates(doc, asOf) {
  const out = {};
  for (const rate of doc.rates) {
    if (rate.as_of > asOf) continue;
    if (!out[rate.currency] || out[rate.currency].as_of < rate.as_of) out[rate.currency] = rate;
  }
  return out;
}

export function foreignCurrencies(doc) {
  const base = doc.base_currency;
  return [...new Set(doc.accounts.filter((a) => a.is_active).map((a) => a.currency))]
    .filter((c) => c !== base)
    .sort();
}

export function overview(doc, asOf) {
  const base = doc.base_currency;
  const classes = activeClasses(doc);
  const liability = Object.fromEntries(classes.map((c) => [c.id, c.is_liability]));
  const cells = latestCells(doc, asOf);
  const rates = latestRates(doc, asOf);

  const totals = Object.fromEntries(classes.map((c) => [c.id, 0]));
  let assets = 0;
  let liabilities = 0;
  const missing = new Set();
  const rows = [];

  for (const acc of sortedAccounts(doc)) {
    const accCells = [...cells.values()].filter((b) => b.account_id === acc.id);
    // 已關閉、而且當時也沒有任何餘額的帳戶，不必出現在這一天
    if (!acc.is_active && !accCells.some((b) => b.amount_minor)) continue;

    let rateMicro;
    if (acc.currency === base) rateMicro = 1_000_000;
    else if (rates[acc.currency]) rateMicro = rates[acc.currency].rate_micro;
    else {
      rateMicro = null;
      if (accCells.length) missing.add(acc.currency);
    }

    const outCells = {};
    let net = 0;
    for (const bal of accCells) {
      if (!(bal.class_id in liability)) continue;
      const baseMinor = rateMicro ? convert(bal.amount_minor, rateMicro) : null;
      outCells[bal.class_id] = { amount_minor: bal.amount_minor, base_minor: baseMinor, as_of: bal.as_of };
      if (baseMinor === null) continue;
      totals[bal.class_id] += baseMinor;
      if (liability[bal.class_id]) {
        liabilities += baseMinor;
        net -= baseMinor;
      } else {
        assets += baseMinor;
        net += baseMinor;
      }
    }

    const last = accCells.reduce((m, b) => (m && m > b.as_of ? m : b.as_of), null);
    const daysOld = last ? daysBetween(last, asOf) : null;
    rows.push({
      id: acc.id,
      name: acc.name,
      institution: acc.institution,
      currency: acc.currency,
      is_active: acc.is_active,
      cells: outCells,
      net_base_minor: rateMicro ? net : null,
      last_updated: last,
      days_old: daysOld,
      stale: Boolean(last && daysOld > STALE_DAYS),
    });
  }

  return {
    as_of: asOf,
    base_currency: base,
    classes: classes.map((c) => ({ id: c.id, name: c.name, is_liability: c.is_liability })),
    accounts: rows,
    class_totals: totals,
    assets_minor: assets,
    liabilities_minor: liabilities,
    net_minor: assets - liabilities,
    rates: Object.fromEntries(
      Object.entries(rates).map(([cur, r]) => [
        cur,
        { rate: microToString(r.rate_micro), as_of: r.as_of, source: r.source },
      ])
    ),
    missing_rates: [...missing].sort(),
  };
}

/**
 * 每個有盤點的日子，當天「截至該日」的總額。
 * 刻意不算報酬率：總額變多可能是賺了，也可能只是存了薪水，只記餘額分不出兩者。
 */
export function history(doc) {
  const days = [...new Set(doc.balances.map((b) => b.as_of))].sort();
  const out = [];
  let previous = null;
  for (const day of days) {
    const snap = overview(doc, day);
    out.push({
      as_of: day,
      assets_minor: snap.assets_minor,
      liabilities_minor: snap.liabilities_minor,
      net_minor: snap.net_minor,
      change_minor: previous === null ? null : snap.net_minor - previous,
      missing_rates: snap.missing_rates,
    });
    previous = snap.net_minor;
  }
  return out.reverse();
}

/* --- 寫入 ------------------------------------------------------------- */

function cleanName(name) {
  const value = String(name ?? "").trim();
  if (!value) throw new Error("請輸入帳戶名稱");
  return value;
}

function checkUnique(doc, name, exceptId = null) {
  if (doc.accounts.some((a) => a.name === name && a.id !== exceptId)) {
    throw new Error(`帳戶名稱已存在：${name}`);
  }
}

export function createAccount(doc, { name, institution = null, currency = "TWD", note = null }) {
  const value = cleanName(name);
  checkUnique(doc, value);
  const acc = {
    id: uid(),
    name: value,
    institution: institution?.trim() || null,
    currency: String(currency).toUpperCase(),
    note,
    sort_order: 0,
    is_active: true,
    created_at: now(),
  };
  doc.accounts.push(acc);
  return acc;
}

/** 刻意不開放改幣別：既有餘額是用舊幣別記的，改了等於全部換算錯。 */
export function updateAccount(doc, id, data) {
  const acc = find(doc.accounts, id, "帳戶不存在");
  const name = data.name !== undefined ? cleanName(data.name) : acc.name;
  checkUnique(doc, name, id);
  acc.name = name;
  if (data.institution !== undefined) acc.institution = data.institution?.trim() || null;
  if (data.note !== undefined) acc.note = data.note;
  return acc;
}

/** 一次盤點。同一天同一格再存就是更正，不會多一筆。 */
export function saveSnapshot(doc, { as_of, cells = [], rates = [] }) {
  const day = parseDate(as_of);
  if (!cells.length && !rates.length) throw new Error("沒有任何要存的數字");
  const accounts = new Set(doc.accounts.map((a) => a.id));
  const classes = new Set(doc.classes.map((c) => c.id));
  const base = doc.base_currency;

  // 全部先驗證，有一格錯就整份不存
  const parsedCells = cells.map((cell) => {
    if (!accounts.has(cell.account_id) || !classes.has(cell.class_id)) throw new Error("帳戶或類別不存在");
    return { ...cell, amount_minor: toMinor(cell.amount) };
  });
  const parsedRates = rates
    .filter((r) => r.currency.toUpperCase() !== base)
    .map((r) => ({ ...r, currency: r.currency.toUpperCase(), rate_micro: toMicro(r.rate) }));

  const stamp = now();
  for (const cell of parsedCells) {
    const existing = doc.balances.find(
      (b) => b.account_id === cell.account_id && b.class_id === cell.class_id && b.as_of === day
    );
    if (existing) {
      existing.amount_minor = cell.amount_minor;
      existing.updated_at = stamp;
    } else {
      doc.balances.push({
        id: uid(),
        account_id: cell.account_id,
        class_id: cell.class_id,
        as_of: day,
        amount_minor: cell.amount_minor,
        updated_at: stamp,
      });
    }
  }
  for (const rate of parsedRates) {
    const existing = doc.rates.find((r) => r.currency === rate.currency && r.as_of === day);
    const source = rate.source || "manual";
    if (existing) {
      existing.rate_micro = rate.rate_micro;
      existing.source = source;
    } else {
      doc.rates.push({ id: uid(), currency: rate.currency, as_of: day, rate_micro: rate.rate_micro, source });
    }
  }
  return { saved: parsedCells.length, as_of: day };
}

/**
 * 關帳戶 = 從這天起餘額歸零，而不是刪掉。
 * 不寫零的話，「截至某日」會讓它最後一次的餘額永遠沿用下去，一直灌水總資產。
 */
export function closeAccount(doc, id, on) {
  const acc = find(doc.accounts, id, "帳戶不存在");
  const day = parseDate(on);
  for (const bal of latestCells(doc, day).values()) {
    if (bal.account_id !== id || bal.amount_minor === 0) continue;
    if (bal.as_of === day) bal.amount_minor = 0;
    else {
      doc.balances.push({
        id: uid(),
        account_id: id,
        class_id: bal.class_id,
        as_of: day,
        amount_minor: 0,
        updated_at: now(),
      });
    }
  }
  acc.is_active = false;
  return acc;
}
