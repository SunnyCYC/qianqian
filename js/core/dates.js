/* 日期與月份。日期一律是 "YYYY-MM-DD"、月份是 "YYYY-MM" 字串，
 * 字串比大小就等於比先後，不必轉 Date。 */

const pad = (n) => String(n).padStart(2, "0");

/** 本地日期，不用 toISOString——那會轉成 UTC 而在深夜跳掉一天。 */
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function monthOf(dateStr) {
  return dateStr.slice(0, 7);
}

export function parseMonth(text) {
  const m = /^(\d{4})-(\d{1,2})/.exec(String(text ?? ""));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
    throw new Error(`月份格式需為 YYYY-MM：${text}`);
  }
  return `${m[1]}-${pad(Number(m[2]))}`;
}

export function parseDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? ""));
  if (!m) throw new Error(`日期格式需為 YYYY-MM-DD：${text}`);
  return text;
}

function monthIndex(ym) {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}

export function addMonths(ym, n) {
  const idx = monthIndex(ym) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

/** 從 a 月到 b 月差幾個月（b 在後為正）。 */
export function monthsBetween(a, b) {
  return monthIndex(monthOf(b)) - monthIndex(monthOf(a));
}

export function monthNumber(ym) {
  return Number(ym.slice(5, 7));
}

export function monthFirstDay(ym) {
  return `${ym}-01`;
}

export function monthLastDay(ym) {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${pad(new Date(y, m, 0).getDate())}`;
}

export function daysBetween(a, b) {
  const toUtc = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}
