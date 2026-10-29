import { describe, expect, test } from "./runner.js";
import { item, ledger } from "./helpers.js";
import * as cf from "../js/core/cashflow.js";

const summary = (doc, month, today = "2026-10-26") => cf.summary(doc, month, today);
const budget = (doc, as_of, rows) => cf.saveBudgets(doc, { as_of, rows });
const catRow = (data, name) => data.categories.find((c) => c.name === name);

describe("每月收支", () => {
  test("可支配 = 收入 − 固定支出", () => {
    const { doc, cat } = ledger();
    item(doc, cat, "月薪", "薪資", "60,000");
    item(doc, cat, "房租", "住", 15000);
    item(doc, cat, "Netflix", "訂閱", 390);
    const data = summary(doc, "2026-10");
    expect(data.income_minor).toBe(6_000_000);
    expect(data.fixed_expense_minor).toBe(1_539_000);
    expect(data.disposable_minor).toBe(4_461_000);
  });

  test("定期投資是存下來的錢，不是花掉", () => {
    const { doc, cat } = ledger();
    item(doc, cat, "月薪", "薪資", 60000);
    item(doc, cat, "房租", "住", 15000);
    item(doc, cat, "0050 定期定額", "定期投資", 5000);
    item(doc, cat, "全球基金", "定期投資", 3000);
    budget(doc, "2026-10-01", [{ category_id: cat["食"], amount: 10000 }]);
    const data = summary(doc, "2026-10");
    expect(data.fixed_expense_minor).toBe(1_500_000);
    expect(data.invest_minor).toBe(800_000);
    expect(data.disposable_minor).toBe(3_700_000);
    expect(data.cash_left_minor).toBe(2_700_000);
    expect(data.savings_minor).toBe(3_500_000);
    expect(data.due_expense_minor).toBe(2_500_000);
    expect(catRow(data, "定期投資").total_minor).toBe(800_000);
  });

  test("年繳平均到每月，但只在扣款月出現", () => {
    const { doc, cat } = ledger();
    item(doc, cat, "壽險", "保險", 24000, { period: "year", due: 3 });
    const oct = summary(doc, "2026-10");
    const mar = summary(doc, "2026-03");
    expect(oct.fixed_expense_minor).toBe(200_000);
    expect(oct.due_expense_minor).toBe(0);
    expect(mar.due_expense_minor).toBe(2_400_000);
    expect(mar.lumpy.map((i) => i.name)).toEqual(["壽險"]);
  });

  test("季繳每三個月一次", () => {
    const { doc, cat } = ledger();
    item(doc, cat, "管理費", "住", 3000, { period: "quarter", due: 1 });
    const due = [];
    for (let m = 1; m <= 12; m++) {
      if (summary(doc, `2026-${String(m).padStart(2, "0")}`).due_expense_minor) due.push(m);
    }
    expect(due).toEqual([1, 4, 7, 10]);
  });

  test("變動預算從存下的錢扣掉", () => {
    const { doc, cat } = ledger();
    item(doc, cat, "月薪", "薪資", 60000);
    item(doc, cat, "房租", "住", 15000);
    budget(doc, "2026-10-01", [
      { category_id: cat["食"], amount: 12000 },
      { category_id: cat["行"], amount: 3000 },
    ]);
    const data = summary(doc, "2026-10");
    expect(data.variable_minor).toBe(1_500_000);
    expect(data.savings_minor).toBe(3_000_000);
    expect(data.savings_rate).toBe(0.5);
    expect(catRow(data, "食").share_of_income).toBe(0.2);
  });

  test("後來的預算不會改寫之前的月份", () => {
    const { doc, cat } = ledger();
    budget(doc, "2026-09-01", [{ category_id: cat["食"], amount: 10000 }]);
    budget(doc, "2026-10-15", [{ category_id: cat["食"], amount: 14000 }]);
    expect(summary(doc, "2026-09").variable_minor).toBe(1_000_000);
    expect(cf.summary(doc, "2026-10", "2026-11-05").variable_minor).toBe(1_400_000);
    // 這個月還沒到 10/15 時，看到的是當時最新的
    expect(cf.summary(doc, "2026-10", "2026-10-03").variable_minor).toBe(1_000_000);
  });

  test("預算細項加總，並記得估了哪些", () => {
    const { doc, cat } = ledger();
    budget(doc, "2026-10-01", [
      { category_id: cat["家庭"], lines: [{ label: "請爸媽吃飯", amount: 3000 }, { label: "孝親紅包", amount: "2,000" }] },
    ]);
    const family = catRow(summary(doc, "2026-10"), "家庭");
    expect(family.variable_minor).toBe(500_000);
    expect(family.budget_lines).toEqual([
      { label: "請爸媽吃飯", amount_minor: 300_000 },
      { label: "孝親紅包", amount_minor: 200_000 },
    ]);
  });

  test("新的估計不影響舊月份的細項", () => {
    const { doc, cat } = ledger();
    budget(doc, "2026-09-01", [{ category_id: cat["育樂"], lines: [{ label: "買書", amount: 800 }] }]);
    budget(doc, "2026-10-01", [{ category_id: cat["育樂"], lines: [{ label: "買書", amount: 500 }, { label: "電影", amount: 600 }] }]);
    expect(catRow(summary(doc, "2026-09"), "育樂").budget_lines.map((l) => l.label)).toEqual(["買書"]);
    expect(catRow(summary(doc, "2026-10"), "育樂").variable_minor).toBe(110_000);
  });

  test("同一天再存會取代細項，刪光就是歸零", () => {
    const { doc, cat } = ledger();
    budget(doc, "2026-10-01", [{ category_id: cat["衣"], lines: [{ label: "A", amount: 1 }, { label: "B", amount: 2 }] }]);
    budget(doc, "2026-10-01", [{ category_id: cat["衣"], lines: [] }]);
    const cloth = catRow(summary(doc, "2026-10"), "衣");
    expect(cloth.budget_lines).toEqual([]);
    expect(cloth.variable_minor).toBe(0);
    expect(doc.budgets.length).toBe(1);
  });

  test("預算只能填在支出類別", () => {
    const { doc, cat } = ledger();
    for (const name of ["薪資", "定期投資"]) {
      expect(() => budget(doc, "2026-10-01", [{ category_id: cat[name], amount: 1 }])).toThrow("支出類別");
    }
  });
});

describe("歷史不被改寫", () => {
  test("房租漲價，之前的月份維持原價", () => {
    const { doc, cat } = ledger();
    const rent = item(doc, cat, "房租", "住", 15000);
    cf.adjustItem(doc, rent, { amount: 16000, effective_month: "2026-07" });
    expect(summary(doc, "2026-06").fixed_expense_minor).toBe(1_500_000);
    expect(summary(doc, "2026-07").fixed_expense_minor).toBe(1_600_000);
    expect(summary(doc, "2026-07").items.length).toBe(1);
  });

  test("第一個月打錯直接更正，不拆成兩筆", () => {
    const { doc, cat } = ledger();
    const sub = item(doc, cat, "Spotify", "訂閱", 1490, { start: "2026-10" });
    cf.adjustItem(doc, sub, { amount: 149, effective_month: "2026-10" });
    const data = summary(doc, "2026-10");
    expect(data.fixed_expense_minor).toBe(14_900);
    expect(data.items.length).toBe(1);
  });

  test("取消訂閱，付過的月份還在", () => {
    const { doc, cat } = ledger();
    const sub = item(doc, cat, "Netflix", "訂閱", 390);
    cf.stopItem(doc, sub, "2026-08");
    expect(summary(doc, "2026-08").fixed_expense_minor).toBe(39_000);
    expect(summary(doc, "2026-09").fixed_expense_minor).toBe(0);
  });

  test("扣款月填錯可以事後改", () => {
    const { doc, cat } = ledger();
    const sub = item(doc, cat, "Cursor", "訂閱", 19000, { period: "year", start: "2026-06", due: 10 });
    cf.updateItem(doc, sub, { due_month: 6 });
    expect(summary(doc, "2026-10").lumpy).toEqual([]);
    expect(summary(doc, "2027-06").lumpy.map((i) => i.name)).toEqual(["Cursor"]);
  });

  test("收入與支出不能互換類別", () => {
    const { doc, cat } = ledger();
    const rent = item(doc, cat, "房租", "住", 15000);
    expect(() => cf.updateItem(doc, rent, { category_id: cat["薪資"] })).toThrow("不能互換");
  });

  test("刪除只刪那一筆", () => {
    const { doc, cat } = ledger();
    const a = item(doc, cat, "A", "住", 1);
    item(doc, cat, "B", "住", 2);
    cf.deleteItem(doc, a);
    expect(doc.items.map((i) => i.name)).toEqual(["B"]);
  });
});
