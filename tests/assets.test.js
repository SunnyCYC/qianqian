import { describe, expect, test } from "./runner.js";
import { account, ledger, snapshot } from "./helpers.js";
import * as assets from "../js/core/assets.js";

describe("資產總覽", () => {
  test("負債類別預設就是負債", () => {
    const { doc } = ledger();
    const flags = Object.fromEntries(doc.classes.map((c) => [c.name, c.is_liability]));
    expect(flags["信用卡未繳"]).toBe(true);
    expect(flags["貸款"]).toBe(true);
    expect(flags["現金"]).toBe(false);
  });

  test("只更新一個帳戶時，其他帳戶沿用上次", () => {
    const { doc, cls } = ledger();
    const bank = account(doc, "台新");
    const broker = account(doc, "永豐證券");
    snapshot(doc, "2026-10-01", [[bank, cls["現金"], "100,000"], [broker, cls["股票"], 50000]]);
    snapshot(doc, "2026-10-25", [[broker, cls["股票"], 60000]]);
    const data = assets.overview(doc, "2026-10-25");
    expect(data.assets_minor).toBe(16_000_000);
    const row = data.accounts.find((r) => r.id === bank);
    expect(row.last_updated).toBe("2026-10-01");
    expect(row.days_old).toBe(24);
  });

  test("較早的日期看不到之後的數字", () => {
    const { doc, cls } = ledger();
    const bank = account(doc, "台新");
    snapshot(doc, "2026-10-01", [[bank, cls["現金"], 100]]);
    snapshot(doc, "2026-10-25", [[bank, cls["現金"], 999]]);
    expect(assets.overview(doc, "2026-10-10").assets_minor).toBe(10_000);
  });

  test("負債從淨資產扣掉", () => {
    const { doc, cls } = ledger();
    const bank = account(doc, "國泰");
    snapshot(doc, "2026-10-25", [
      [bank, cls["現金"], 100000],
      [bank, cls["信用卡未繳"], 12000],
      [bank, cls["貸款"], 30000],
    ]);
    const data = assets.overview(doc, "2026-10-25");
    expect(data.assets_minor).toBe(10_000_000);
    expect(data.liabilities_minor).toBe(4_200_000);
    expect(data.net_minor).toBe(5_800_000);
  });

  test("外幣用當天的匯率換算，原幣金額保留", () => {
    const { doc, cls } = ledger();
    const eur = account(doc, "歐元帳戶", "EUR");
    const us = account(doc, "美股", "usd");
    snapshot(doc, "2026-10-25", [[eur, cls["現金"], 200], [us, cls["股票"], "1000.50"]], [["EUR", "36.5"], ["USD", "32.6"]]);
    const data = assets.overview(doc, "2026-10-25");
    expect(data.class_totals[cls["現金"]]).toBe(730_000);
    expect(data.class_totals[cls["股票"]]).toBe(3_261_630);
    expect(data.accounts.find((r) => r.id === us).cells[cls["股票"]].amount_minor).toBe(100_050);
    expect(data.rates.USD.rate).toBe("32.6");
  });

  test("沒有匯率就不算進總額，而是標出來", () => {
    const { doc, cls } = ledger();
    const eur = account(doc, "歐元帳戶", "EUR");
    snapshot(doc, "2026-10-25", [[eur, cls["現金"], 200]]);
    const data = assets.overview(doc, "2026-10-25");
    expect(data.assets_minor).toBe(0);
    expect(data.missing_rates).toEqual(["EUR"]);
  });

  test("同一天同一格再存是更正", () => {
    const { doc, cls } = ledger();
    const bank = account(doc, "台新");
    snapshot(doc, "2026-10-25", [[bank, cls["現金"], 100]]);
    snapshot(doc, "2026-10-25", [[bank, cls["現金"], 150]]);
    expect(assets.overview(doc, "2026-10-25").assets_minor).toBe(15_000);
    expect(assets.history(doc).length).toBe(1);
  });

  test("關掉的帳戶不再灌水之後的總額", () => {
    const { doc, cls } = ledger();
    const bank = account(doc, "舊帳戶");
    snapshot(doc, "2026-09-01", [[bank, cls["現金"], 500]]);
    assets.closeAccount(doc, bank, "2026-10-01");
    expect(assets.overview(doc, "2026-09-15").assets_minor).toBe(50_000);
    expect(assets.overview(doc, "2026-10-25").assets_minor).toBe(0);
    expect(doc.accounts[0].is_active).toBe(false);
    expect(assets.overview(doc, "2026-10-25").accounts.length).toBe(0);
  });

  test("歷次盤點有變化、沒有報酬率", () => {
    const { doc, cls } = ledger();
    const bank = account(doc, "台新");
    snapshot(doc, "2026-09-01", [[bank, cls["現金"], 100]]);
    snapshot(doc, "2026-10-01", [[bank, cls["現金"], 130]]);
    const rows = assets.history(doc);
    expect(rows[0].as_of).toBe("2026-10-01");
    expect(rows[0].change_minor).toBe(3_000);
    expect(rows[1].change_minor).toBe(null);
  });

  test("有一格看不懂就整份不存", () => {
    const { doc, cls } = ledger();
    const bank = account(doc, "台新");
    expect(() => snapshot(doc, "2026-10-25", [[bank, cls["現金"], "100"], [bank, cls["定存"], "abc"]])).toThrow("看不懂");
    expect(doc.balances.length).toBe(0);
  });

  test("帳戶名稱重複要說明", () => {
    const { doc } = ledger();
    account(doc, "台新");
    expect(() => account(doc, "台新")).toThrow("已存在");
    const other = account(doc, "國泰");
    expect(() => assets.updateAccount(doc, other, { name: "台新" })).toThrow("已存在");
  });
});
