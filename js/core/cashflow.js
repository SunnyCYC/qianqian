/* 每月收支：固定項目換算月均、變動花費預算、可支配金額。
 *
 *   實領收入 − 固定支出 − 定期投資 = 可支配金額
 *   可支配金額 − 變動花費預算     = 每月留在現金
 *   留在現金 + 定期投資           = 每月共存下
 *
 * 「月均」與「這個月實際要付」分開算。年繳保費月均是 1/12，但它真的扣款的
 * 那個月會突然多一大筆，只看月均會看不出那個月為什麼缺錢。
 *
 * 金額變了不覆蓋：結束舊的一筆、從生效月開一筆新的。直接改數字會讓去年的
 * 月份也跟著變，歷史會說謊。
 */

import { toMinor } from "./money.js";
import { addMonths, localDate, monthFirstDay, monthLastDay, monthNumber, parseDate, parseMonth } from "./dates.js";
import { find, now, uid } from "./ledger.js";

export const PERIOD_MONTHS = { month: 1, quarter: 3, year: 12 };

export function categories(doc) {
  return doc.categories.filter((c) => c.is_active).sort((a, b) => a.sort_order - b.sort_order);
}

export const monthlyEquiv = (item) => Math.round(item.amount_minor / PERIOD_MONTHS[item.period]);

export function isActive(item, month) {
  if (item.start_month > month) return false;
  return item.end_month === null || item.end_month >= month;
}

/** 這個月是否真的要付（或真的入帳）。 */
export function isDue(item, month) {
  if (item.period === "month") return true;
  const anchor = item.due_month || monthNumber(item.start_month);
  const m = monthNumber(month);
  if (item.period === "year") return m === anchor;
  return (((m - anchor) % 3) + 3) % 3 === 0;
}

function latestBudgets(doc, on) {
  const out = {};
  for (const b of doc.budgets) {
    if (b.as_of > on) continue;
    if (!out[b.category_id] || out[b.category_id].as_of < b.as_of) out[b.category_id] = b;
  }
  return out;
}

function itemDict(item, kind, month) {
  return {
    id: item.id,
    name: item.name,
    category_id: item.category_id,
    kind,
    amount_minor: item.amount_minor,
    period: item.period,
    due_month: item.due_month,
    start_month: item.start_month,
    end_month: item.end_month,
    note: item.note,
    monthly_minor: monthlyEquiv(item),
    due_this_month: isDue(item, month),
  };
}

const ratio = (a, b) => Math.round((a / b) * 10000) / 10000;

export function summary(doc, month, today = localDate()) {
  const cats = categories(doc);
  const kind = Object.fromEntries(cats.map((c) => [c.id, c.kind]));
  const items = doc.items.filter((i) => isActive(i, month) && i.category_id in kind);

  // 這個月還沒過完就看到今天為止的預算；過去的月份看月底那時的
  const first = monthFirstDay(month);
  const last = monthLastDay(month);
  const cutoff = [last, today > first ? today : first].sort()[0];
  const budgets = latestBudgets(doc, cutoff);

  const perCat = Object.fromEntries(cats.map((c) => [c.id, { fixed_minor: 0, variable_minor: 0, due_minor: 0 }]));
  let income = 0, fixed = 0, invest = 0, dueIncome = 0, dueExpense = 0, dueInvest = 0;
  for (const item of items) {
    const m = monthlyEquiv(item);
    const due = isDue(item, month) ? item.amount_minor : 0;
    perCat[item.category_id].fixed_minor += m;
    perCat[item.category_id].due_minor += due;
    if (kind[item.category_id] === "income") {
      income += m;
      dueIncome += due;
    } else if (kind[item.category_id] === "invest") {
      invest += m;
      dueInvest += due;
    } else {
      fixed += m;
      dueExpense += due;
    }
  }

  let variable = 0;
  for (const [catId, b] of Object.entries(budgets)) {
    if (kind[catId] !== "expense") continue;
    perCat[catId].variable_minor = b.amount_minor;
    variable += b.amount_minor;
  }

  // 定期投資每月自動扣走，實際上不能拿來花，所以可支配要先扣掉它
  const disposable = income - fixed - invest;
  const cashLeft = disposable - variable;
  // 總共存下的錢＝留在現金的＋放進投資的；淨資產每月大約增加這麼多
  const savings = cashLeft + invest;

  return {
    month,
    income_minor: income,
    fixed_expense_minor: fixed,
    disposable_minor: disposable,
    variable_minor: variable,
    savings_minor: savings,
    savings_rate: income ? ratio(savings, income) : null,
    invest_minor: invest,
    cash_left_minor: cashLeft,
    due_invest_minor: dueInvest,
    due_income_minor: dueIncome,
    due_expense_minor: dueExpense + variable,
    categories: cats.map((c) => {
      const row = perCat[c.id];
      const total = row.fixed_minor + row.variable_minor;
      const b = budgets[c.id];
      return {
        id: c.id,
        name: c.name,
        kind: c.kind,
        ...row,
        total_minor: total,
        share_of_income: income && c.kind !== "income" ? ratio(total, income) : null,
        budget_as_of: b ? b.as_of : null,
        budget_lines: b ? b.lines.map((l) => ({ label: l.label, amount_minor: l.amount_minor })) : [],
      };
    }),
    items: items.map((i) => itemDict(i, kind[i.category_id], month)),
    lumpy: items.filter((i) => i.period !== "month" && isDue(i, month)).map((i) => itemDict(i, kind[i.category_id], month)),
  };
}

/* --- 寫入 ------------------------------------------------------------- */

function checkPeriod(period, dueMonth) {
  if (!(period in PERIOD_MONTHS)) throw new Error("週期只能是每月、每季或每年");
  if (dueMonth !== null && dueMonth !== undefined && !(dueMonth >= 1 && dueMonth <= 12)) {
    throw new Error("扣款月份需在 1 到 12 之間");
  }
}

export function createItem(doc, data) {
  const cat = find(doc.categories, data.category_id, "類別不存在");
  checkPeriod(data.period, data.due_month);
  const name = String(data.name ?? "").trim();
  if (!name) throw new Error("請輸入名稱");
  const item = {
    id: uid(),
    name,
    category_id: cat.id,
    amount_minor: toMinor(data.amount),
    period: data.period,
    due_month: data.period === "month" ? null : data.due_month ?? null,
    start_month: parseMonth(data.start_month),
    end_month: null,
    note: data.note ?? null,
    created_at: now(),
  };
  doc.items.push(item);
  return item;
}

/** 只改名稱、類別、扣款月。金額另走 adjustItem，才不會改掉過去的月份。 */
export function updateItem(doc, id, data) {
  const item = find(doc.items, id, "項目不存在");
  if (data.category_id !== undefined) {
    const oldCat = find(doc.categories, item.category_id, "類別不存在");
    const newCat = doc.categories.find((c) => c.id === data.category_id);
    if (!newCat || newCat.kind !== oldCat.kind) throw new Error("收入與支出不能互換類別");
  }
  if (data.due_month !== undefined && item.period !== "month") checkPeriod(item.period, data.due_month);
  if (data.name !== undefined) {
    const name = String(data.name).trim();
    if (!name) throw new Error("請輸入名稱");
    item.name = name;
  }
  if (data.category_id !== undefined) item.category_id = data.category_id;
  if (data.due_month !== undefined && item.period !== "month") item.due_month = data.due_month;
  if (data.note !== undefined) item.note = data.note;
  return item;
}

/**
 * 改金額。從生效月起是新的一筆，之前的月份保持原樣。
 * 生效月就是起始月（例如剛建立就發現打錯）時直接更正，不必多一筆。
 */
export function adjustItem(doc, id, { amount, effective_month }) {
  const item = find(doc.items, id, "項目不存在");
  const when = parseMonth(effective_month);
  const newMinor = toMinor(amount);
  if (when <= item.start_month) {
    item.amount_minor = newMinor;
    return item;
  }
  if (item.end_month !== null && item.end_month < when) throw new Error("這個項目在生效月之前就已經停止了");
  const successor = { ...item, id: uid(), amount_minor: newMinor, start_month: when, created_at: now() };
  item.end_month = addMonths(when, -1);
  doc.items.push(successor);
  return successor;
}

export function stopItem(doc, id, lastMonth) {
  const item = find(doc.items, id, "項目不存在");
  const last = parseMonth(lastMonth);
  if (last < item.start_month) throw new Error("最後一個月不能早於開始的月份");
  item.end_month = last;
  return item;
}

/** 給「建錯了」用。真的不再付了請用 stopItem，過去的月份才會留著。 */
export function deleteItem(doc, id) {
  find(doc.items, id, "項目不存在");
  doc.items = doc.items.filter((i) => i.id !== id);
}

/** 存一份預算估計。細項整份取代那天原本的細項；給了空的細項就是歸零。 */
export function saveBudgets(doc, { as_of, rows }) {
  const day = parseDate(as_of);
  if (!rows?.length) throw new Error("沒有任何要存的數字");
  const parsed = rows.map((row) => {
    const cat = find(doc.categories, row.category_id, "類別不存在");
    if (cat.kind !== "expense") throw new Error("預算只能填在支出類別");
    const lines = (row.lines || []).map((l) => ({
      label: String(l.label ?? "").trim(),
      amount_minor: toMinor(l.amount),
    }));
    let amount;
    if (lines.length) amount = lines.reduce((s, l) => s + l.amount_minor, 0);
    else if (row.amount !== undefined && row.amount !== null) amount = toMinor(row.amount);
    else if (row.lines) amount = 0;
    else throw new Error(`「${cat.name}」沒有金額`);
    return { category_id: cat.id, amount_minor: amount, lines };
  });

  for (const row of parsed) {
    const existing = doc.budgets.find((b) => b.category_id === row.category_id && b.as_of === day);
    if (existing) {
      existing.amount_minor = row.amount_minor;
      existing.lines = row.lines;
      existing.updated_at = now();
    } else {
      doc.budgets.push({ id: uid(), as_of: day, ...row, updated_at: now() });
    }
  }
  return parsed.length;
}
