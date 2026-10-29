/* 極小的測試執行器：不需要 Node，打開 tests/index.html 就會跑。 */

const tests = [];
let prefix = "";

export function describe(name, fn) {
  const saved = prefix;
  prefix = prefix ? `${prefix} › ${name}` : name;
  fn();
  prefix = saved;
}

export function test(name, fn) {
  tests.push({ name: prefix ? `${prefix} › ${name}` : name, fn });
}

const show = (v) => JSON.stringify(v);

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
}

export const expect = (actual) => ({
  toBe(expected) {
    if (actual !== expected) throw new Error(`預期 ${show(expected)}，實際 ${show(actual)}`);
  },
  toEqual(expected) {
    if (!deepEqual(actual, expected)) throw new Error(`預期 ${show(expected)}，實際 ${show(actual)}`);
  },
  toThrow(pattern) {
    try {
      actual();
    } catch (err) {
      if (pattern && !String(err.message).includes(pattern)) {
        throw new Error(`錯誤訊息不含「${pattern}」：${err.message}`);
      }
      return;
    }
    throw new Error("預期丟出錯誤，但沒有");
  },
});

export async function run(mount) {
  const results = [];
  for (const t of tests) {
    try {
      await t.fn();
      results.push({ name: t.name, ok: true });
    } catch (err) {
      results.push({ name: t.name, ok: false, error: err.message });
    }
  }
  const failed = results.filter((r) => !r.ok);
  mount.innerHTML = "";
  const head = document.createElement("h2");
  head.textContent = failed.length
    ? `${failed.length} 個失敗／共 ${results.length} 個`
    : `全部通過（${results.length} 個）`;
  head.className = failed.length ? "fail" : "pass";
  mount.append(head);
  for (const r of [...failed, ...results.filter((r) => r.ok)]) {
    const line = document.createElement("div");
    line.className = r.ok ? "pass" : "fail";
    line.textContent = `${r.ok ? "✓" : "✗"} ${r.name}${r.ok ? "" : `：${r.error}`}`;
    mount.append(line);
  }
  window.__results = { total: results.length, failed };
  document.title = failed.length ? `FAIL ${failed.length}/${results.length}` : `PASS ${results.length}`;
}
