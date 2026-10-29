import { describe, expect, test } from "./runner.js";
import { account, item, ledger, snapshot } from "./helpers.js";
import * as wl from "../js/core/wishlist.js";

const TODAY = "2026-10-26";

const wish = (doc, name, month, lines, category_id = null) =>
  wl.createWish(doc, { name, target_month: month, category_id, lines: lines.map(([label, amount]) => ({ label, amount })) }).id;

/** 現金 100,000、股票 500,000、信用卡未繳 20,000 → 淨資產 580,000，可動用 80,000。 */
function withAssets() {
  const l = ledger();
  const acc = account(l.doc, "銀行");
  snapshot(l.doc, "2026-10-01", [
    [acc, l.cls["現金"], 100000],
    [acc, l.cls["股票"], 500000],
    [acc, l.cls["信用卡未繳"], 20000],
  ]);
  return l;
}

describe("慾望清單：短中長期", () => {
  const cases = [
    ["2026-09", "short"],
    ["2026-10", "short"],
    ["2026-11", "short"],
    ["2026-12", "mid"],
    ["2027-04", "mid"],
    ["2027-05", "long"],
    [null, "long"],
  ];
  for (const [month, expected] of cases) {
    test(`${month ?? "未定"} 是 ${expected}`, () => {
      const { doc } = ledger();
      wish(doc, "x", month, [["", 1]]);
      expect(wl.summary(doc, TODAY).items[0].bucket).toBe(expected);
    });
  }

  test("時間到了自己往前移", () => {
    const { doc } = ledger();
    wish(doc, "筆電", "2027-03", [["", 45000]]);
    expect(wl.summary(doc, TODAY).items[0].bucket).toBe("mid");
    expect(wl.summary(doc, "2027-02-10").items[0].bucket).toBe("short");
  });

  test("過了還沒買的標成已過", () => {
    const { doc } = ledger();
    wish(doc, "x", "2026-09", [["", 1]]);
    expect(wl.summary(doc, TODAY).items[0].overdue).toBe(true);
  });
});

describe("慾望清單：對照資產", () => {
  test("扣除是累積的", () => {
    const { doc } = withAssets();
    wish(doc, "耳機", "2026-11", [["", 10000]]);
    wish(doc, "日本旅行", "2027-02", [["機票", 15000], ["住宿", "20,000"]]);
    wish(doc, "換車", null, [["頭期款", 200000]]);
    const data = wl.summary(doc, TODAY);
    expect(data.net_minor).toBe(58_000_000);
    expect(data.totals).toEqual({ short: 1_000_000, mid: 3_500_000, long: 20_000_000 });
    expect(data.remaining).toEqual({ short: 57_000_000, mid: 53_500_000, long: 33_500_000 });
  });

  test("先用現金，現金用完才動用其他", () => {
    const { doc } = withAssets();
    wish(doc, "a", "2026-11", [["", 50000]]);
    wish(doc, "b", "2027-02", [["", 60000]]);
    wish(doc, "c", null, [["", 100000]]);
    const data = wl.summary(doc, TODAY);
    expect(data.start).toEqual({ cash_minor: 8_000_000, other_minor: 50_000_000 });
    expect(data.breakdown).toEqual({
      short: { cash_minor: 3_000_000, other_minor: 50_000_000 },
      mid: { cash_minor: 0, other_minor: 47_000_000 },
      long: { cash_minor: 0, other_minor: 37_000_000 },
    });
    for (const b of wl.BUCKETS) {
      expect(data.breakdown[b].cash_minor + data.breakdown[b].other_minor).toBe(data.remaining[b]);
    }
  });

  test("可動用現金是負的時，全部從其他資產扣", () => {
    const { doc, cls } = ledger();
    const acc = account(doc, "x");
    snapshot(doc, "2026-10-01", [[acc, cls["現金"], 1000], [acc, cls["信用卡未繳"], 3000], [acc, cls["股票"], 10000]]);
    wish(doc, "a", "2026-11", [["", 500]]);
    expect(wl.summary(doc, TODAY).breakdown.short).toEqual({ cash_minor: -200_000, other_minor: 950_000 });
  });

  test("可動用現金 = 現金 − 信用卡未繳", () => {
    const { doc } = withAssets();
    expect(wl.summary(doc, TODAY).liquid_minor).toBe(8_000_000);
  });

  test("中長期會加上每月可存", () => {
    const { doc, cat } = withAssets();
    item(doc, cat, "月薪", "薪資", 50000);
    item(doc, cat, "房租", "住", 20000);
    wish(doc, "日本旅行", "2027-02", [["", 40000]]);
    const data = wl.summary(doc, TODAY);
    expect(data.monthly_savings_minor).toBe(3_000_000);
    expect(data.projected.mid).toBe((580_000 + 30_000 * 6 - 40_000) * 100);
    expect(data.projected.short).toBe(null);
  });

  test("沒有在存錢就不估", () => {
    const { doc } = withAssets();
    expect(wl.summary(doc, TODAY).projected.mid).toBe(null);
  });
});

describe("慾望清單：買了、不買了", () => {
  test("買了和不買了都不再扣，但留著紀錄", () => {
    const { doc } = withAssets();
    const a = wish(doc, "耳機", "2026-11", [["", 10000]]);
    const b = wish(doc, "手錶", "2026-11", [["", 8000]]);
    wl.closeWish(doc, a, "bought", TODAY);
    wl.closeWish(doc, b, "dropped", TODAY);
    const data = wl.summary(doc, TODAY);
    expect(data.totals.short).toBe(0);
    expect(Object.fromEntries(data.closed.map((i) => [i.name, i.status]))).toEqual({ 耳機: "bought", 手錶: "dropped" });
    wl.reopenWish(doc, b);
    expect(wl.summary(doc, TODAY).totals.short).toBe(800_000);
  });

  test("編輯細項是整份取代", () => {
    const { doc } = ledger();
    const a = wish(doc, "旅行", "2027-02", [["機票", 15000], ["住宿", 20000]]);
    wl.updateWish(doc, a, { lines: [{ label: "機票", amount: 12000 }] });
    const it = wl.summary(doc, TODAY).items[0];
    expect(it.amount_minor).toBe(1_200_000);
    expect(it.lines.map((l) => l.label)).toEqual(["機票"]);
  });

  test("清掉月份就變長期", () => {
    const { doc } = ledger();
    const a = wish(doc, "旅行", "2026-11", [["", 1]]);
    wl.updateWish(doc, a, { target_month: null });
    expect(wl.summary(doc, TODAY).items[0].bucket).toBe("long");
  });

  test("至少要有一個價格；類別要是支出", () => {
    const { doc, cat } = ledger();
    expect(() => wl.createWish(doc, { name: "x", lines: [] })).toThrow("至少要有一個價格");
    expect(() => wl.createWish(doc, { name: "x", category_id: cat["薪資"], lines: [{ amount: 1 }] })).toThrow("支出類別");
  });
});
