/* 一本帳本的資料。整本是一份 JSON：小到每次存檔整份寫回也只要幾毫秒，
 * 也方便整份加密、匯出成一個備份檔。
 *
 * id 用隨機 UUID 而不是流水號：之後手機和電腦要合併同一本帳時，
 * 兩邊各自新增的資料才不會撞號。
 */

export const LEDGER_VERSION = 1;
export const BASE_CURRENCY = "TWD";

// 負債輸入正數，總覽時減掉
export const DEFAULT_CLASSES = [
  ["現金", false],
  ["定存", false],
  ["基金", false],
  ["股票", false],
  ["其他資產", false],
  ["信用卡未繳", true],
  ["貸款", true],
];

export const DEFAULT_CATEGORIES = [
  ["薪資", "income"],
  ["獎金", "income"],
  ["副業", "income"],
  ["投資收益", "income"],
  ["其他收入", "income"],
  ["食", "expense"],
  ["衣", "expense"],
  ["住", "expense"],
  ["行", "expense"],
  ["育樂", "expense"],
  ["家庭", "expense"],
  ["訂閱", "expense"],
  ["保險", "expense"],
  ["貸款", "expense"],
  ["稅費", "expense"],
  ["其他支出", "expense"],
  // 錢沒有花掉，是從現金搬進資產；所以不算支出，自成一種
  ["定期投資", "invest"],
];

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

export function newLedger() {
  return {
    version: LEDGER_VERSION,
    base_currency: BASE_CURRENCY,
    accounts: [],
    classes: DEFAULT_CLASSES.map(([name, is_liability], i) => ({
      id: uid(),
      name,
      is_liability,
      sort_order: i,
      is_active: true,
    })),
    balances: [],
    rates: [],
    categories: DEFAULT_CATEGORIES.map(([name, kind], i) => ({
      id: uid(),
      name,
      kind,
      sort_order: i,
      is_active: true,
    })),
    items: [],
    budgets: [],
    wishes: [],
  };
}

export function hasData(doc) {
  return Boolean(doc.accounts.length || doc.items.length || doc.budgets.length || doc.wishes.length);
}

export function find(list, id, message) {
  const found = list.find((x) => x.id === id);
  if (!found) throw new Error(message);
  return found;
}
