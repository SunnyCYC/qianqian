import { newLedger } from "../js/core/ledger.js";
import * as assets from "../js/core/assets.js";
import * as cashflow from "../js/core/cashflow.js";

export function ledger() {
  const doc = newLedger();
  const cls = Object.fromEntries(doc.classes.map((c) => [c.name, c.id]));
  const cat = Object.fromEntries(doc.categories.map((c) => [c.name, c.id]));
  return { doc, cls, cat };
}

export const account = (doc, name, currency = "TWD") => assets.createAccount(doc, { name, currency }).id;

export function snapshot(doc, as_of, cells, rates = []) {
  return assets.saveSnapshot(doc, {
    as_of,
    cells: cells.map(([account_id, class_id, amount]) => ({ account_id, class_id, amount })),
    rates: rates.map(([currency, rate]) => ({ currency, rate })),
  });
}

export function item(doc, cat, name, catName, amount, { period = "month", start = "2026-01", due = null } = {}) {
  return cashflow.createItem(doc, {
    name,
    category_id: cat[catName],
    amount,
    period,
    due_month: due,
    start_month: start,
  }).id;
}
