import { describe, expect, test } from "./runner.js";
import { convert, microToString, toMicro, toMinor } from "../js/core/money.js";
import { addMonths, daysBetween, monthLastDay, monthsBetween, parseMonth } from "../js/core/dates.js";

describe("金額", () => {
  test("千分位、全形逗號、空白都去掉", () => {
    expect(toMinor("60,000")).toBe(6_000_000);
    expect(toMinor("1，234.5")).toBe(123_450);
    expect(toMinor(" 15000 ")).toBe(1_500_000);
    expect(toMinor(390)).toBe(39_000);
  });

  test("全形數字也看得懂", () => {
    expect(toMinor("３０００")).toBe(300_000);
  });

  test("小數第三位四捨五入，.5 遠離零", () => {
    expect(toMinor("0.005")).toBe(1);
    expect(toMinor("0.004")).toBe(0);
    expect(toMinor("-0.005")).toBe(-1);
    expect(toMinor("1000.50")).toBe(100_050);
  });

  test("看不懂的數字要說出來", () => {
    expect(() => toMinor("abc")).toThrow("看不懂");
    expect(() => toMinor("")).toThrow("不可為空");
    expect(() => toMinor("1.2.3")).toThrow("看不懂");
  });

  test("匯率必須大於 0", () => {
    expect(toMicro("32.6")).toBe(32_600_000);
    expect(() => toMicro("0")).toThrow("大於 0");
  });

  test("換算不會有浮點誤差", () => {
    expect(convert(100_050, 32_600_000)).toBe(3_261_630);
    expect(convert(20_000, 36_500_000)).toBe(730_000);
    expect(convert(-100, 1_500_000)).toBe(-150);
  });

  test("匯率顯示去掉多餘的零", () => {
    expect(microToString(32_583_900)).toBe("32.5839");
    expect(microToString(30_000_000)).toBe("30");
  });
});

describe("月份", () => {
  test("跨年加減", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  test("不合法的月份", () => {
    expect(() => parseMonth("2026-13")).toThrow("YYYY-MM");
    expect(parseMonth("2026-6")).toBe("2026-06");
  });

  test("月底、月差、日差", () => {
    expect(monthLastDay("2028-02")).toBe("2028-02-29");
    expect(monthsBetween("2026-10-26", "2027-04")).toBe(6);
    expect(daysBetween("2026-10-01", "2026-10-25")).toBe(24);
  });
});
