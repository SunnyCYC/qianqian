/* 金額與匯率的換算。
 *
 * 金額一律存整數的最小單位（amount_minor = 元 × 100），匯率存 rate_micro = 匯率 × 1e6。
 * 用浮點數加總會冒出 0.0000001 的誤差，所以解析字串時直接拆成整數，相乘用 BigInt。
 */

const FULLWIDTH = /[０-９．－＋]/g;

function normalize(value) {
  return String(value ?? "")
    .replace(FULLWIDTH, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[,，\s]/g, "")
    .trim();
}

/** "1,234.567" → 以 10^digits 為單位的整數，四捨五入（.5 遠離零，同 Python 的 ROUND_HALF_UP）。 */
function scaled(value, digits) {
  const text = normalize(value);
  if (!text) throw new Error("金額不可為空");
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!m || (!m[2] && !m[3])) throw new Error(`看不懂這個數字：${value}`);
  const [, sign, whole, frac = ""] = m;
  const padded = (frac + "0".repeat(digits + 1)).slice(0, digits + 1);
  let n = BigInt((whole || "0") + padded.slice(0, digits));
  if (Number(padded[digits]) >= 5) n += 1n;
  if (sign === "-") n = -n;
  return n;
}

export function toMinor(value) {
  return Number(scaled(value, 2));
}

export function toMicro(value) {
  const n = scaled(value, 6);
  if (n <= 0n) throw new Error("匯率必須大於 0");
  return Number(n);
}

/** 原幣金額 × 匯率 → 本位幣最小單位。 */
export function convert(amountMinor, rateMicro) {
  const product = BigInt(amountMinor) * BigInt(rateMicro);
  const negative = product < 0n;
  const abs = negative ? -product : product;
  let q = abs / 1_000_000n;
  if ((abs % 1_000_000n) * 2n >= 1_000_000n) q += 1n;
  return Number(negative ? -q : q);
}

export function microToString(rateMicro) {
  const whole = Math.floor(rateMicro / 1_000_000);
  const frac = String(rateMicro % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}
