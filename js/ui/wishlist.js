/* 慾望清單：打算花的錢，對照現有資產。 */

import { api } from "../api.js";
import { el, localDate, onClickOutside, positionPopover, toast } from "../util.js";
import { confirmBox, modal, selectField, textField } from "../dialog.js";

const fmt = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 });
const money = (minor) => (minor === null || minor === undefined ? "—" : fmt.format(minor / 100));
const plain = (minor) => String(Math.round(minor) / 100);
const parseAmount = (text) => Number(String(text).replace(/,/g, "").trim());

const BUCKETS = [
  { key: "short", label: "短期", hint: "一個月內" },
  { key: "mid", label: "中期", hint: "半年內" },
  { key: "long", label: "長期", hint: "半年以上或未定" },
];

const expanded = new Set();
let showClosed = false;

function addMonths(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/* --- 總覽上的卡片 ----------------------------------------------------- */

/** 淨資產 → 扣短期後 → 再扣中期後 → 再扣長期後。清單是空的就不顯示。 */
export function wishCards(w) {
  if (!w || !w.items.length) return null;
  const { totals, remaining, projected, projection_months: months } = w;
  // 剩下的錢裡，現金和其他（定存、基金、股票…）各占多少。
  // 現金先扣，所以現金歸零代表接下來的計畫要動用到投資
  const split = (parts) => {
    if (!parts) return null;
    const total = parts.cash_minor + parts.other_minor;
    const share = (minor) => (total > 0 ? `（${Math.round((minor / total) * 100)}%）` : "");
    return el(
      "div",
      { class: "wish-split" },
      el(
        "div",
        { class: parts.cash_minor > 0 ? "wish-pos" : "wish-neg" },
        `現金 ${money(parts.cash_minor)}${share(Math.max(parts.cash_minor, 0))}`
      ),
      el("div", { class: "fin-acc-meta" }, `其他 ${money(parts.other_minor)}${share(parts.other_minor)}`)
    );
  };
  const card = (label, minor, parts, sub = []) =>
    el(
      "div",
      { class: `fin-card ${minor < 0 ? "fin-neg" : ""}` },
      el("div", { class: "fin-card-label" }, label),
      el("div", { class: "fin-card-value" }, money(minor)),
      split(parts),
      ...sub.filter(Boolean).map((s) => el("div", { class: "fin-acc-meta" }, s))
    );
  const projection = (key) =>
    projected[key] === null
      ? null
      : `照每月可存累積，${months[key] === 6 ? "半年" : `${months[key] / 12} 年`}後約剩 ${money(projected[key])}`;

  const short = totals.short;
  const liquidNote = short
    ? el(
        "p",
        { class: w.liquid_minor >= short ? "fin-note" : "fin-warn" },
        `短期清單 ${money(short)}，可動用現金（現金 − 信用卡未繳）${money(w.liquid_minor)}：` +
          (w.liquid_minor >= short
            ? `夠，用完還剩 ${money(w.liquid_minor - short)}`
            : `不夠，差 ${money(short - w.liquid_minor)}，可能要動用定存或投資`)
      )
    : null;

  return el(
    "div",
    { class: "fin-summary" },
    el("h2", { class: "fin-sub" }, "對照慾望清單"),
    el(
      "div",
      { class: "fin-cards" },
      card("目前", w.net_minor, w.start, ["現金＝現金 − 信用卡未繳"]),
      card("扣掉短期後", remaining.short, w.breakdown?.short, [`短期 ${money(totals.short)}`]),
      card("再扣中期後", remaining.mid, w.breakdown?.mid, [`中期 ${money(totals.mid)}`, projection("mid")]),
      card("再扣長期後", remaining.long, w.breakdown?.long, [`長期 ${money(totals.long)}`, projection("long")])
    ),
    liquidNote,
    w.missing_rates.length
      ? el("p", { class: "fin-warn" }, `淨資產沒有算進 ${w.missing_rates.join("、")} 帳戶（缺匯率）。`)
      : null
  );
}

/* --- 清單區塊 --------------------------------------------------------- */

export function wishSection(w, reload) {
  const header = el(
    "div",
    { class: "wish-head" },
    el("h2", {}, "慾望清單"),
    el("span", { class: "spacer" }),
    el(
      "button",
      { class: "btn btn-sm", type: "button", onclick: () => editWish(null, reload) },
      "+ 想買的"
    )
  );
  if (!w) return el("section", { class: "fin-history" }, header);

  const groups = BUCKETS.map((b) => {
    const items = w.items.filter((i) => i.bucket === b.key);
    return [
      el(
        "tr",
        { class: "fin-group" },
        el("td", {}, `${b.label}・${b.hint}`),
        el("td", { class: "num" }, items.length ? money(w.totals[b.key]) : ""),
        el("td", { colspan: "2" })
      ),
      ...(items.length
        ? items.flatMap((i) => wishRows(i, reload))
        : [el("tr", { class: "fin-detail" }, el("td", { colspan: "4", class: "faint" }, "（沒有）"))]),
    ];
  }).flat();

  const closedToggle = w.closed.length
    ? el(
        "button",
        {
          class: "link-btn wish-closed-toggle",
          type: "button",
          onclick: () => {
            showClosed = !showClosed;
            reload();
          },
        },
        showClosed ? "收起已完成" : `已完成 ${w.closed.length} 項`
      )
    : null;

  return el(
    "section",
    { class: "fin-history" },
    header,
    el(
      "div",
      { class: "fin-table-wrap" },
      el(
        "table",
        { class: "fin-table" },
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            el("th", {}, "項目"),
            el("th", { class: "num" }, "金額"),
            el("th", {}, "預計"),
            el("th", {}, "")
          )
        ),
        el("tbody", {}, ...groups)
      )
    ),
    closedToggle,
    showClosed && w.closed.length ? closedTable(w.closed, reload) : null
  );
}

function wishRows(item, reload) {
  const hasDetail = item.lines.length > 1 || item.lines.some((l) => l.label);
  const details = hasDetail
    ? item.lines.map((l) =>
        el(
          "tr",
          { class: "fin-detail" },
          el("td", {}, l.label || "（未命名）"),
          el("td", { class: "num" }, money(l.amount_minor)),
          el("td", { colspan: "2" })
        )
      )
    : [];
  const open = expanded.has(item.id);
  details.forEach((d) => (d.hidden = !open));
  const caret = el("span", { class: "fin-caret" }, hasDetail ? (open ? "▾" : "▸") : "");

  const row = el(
    "tr",
    {
      class: hasDetail ? "fin-expandable" : "",
      onclick: (e) => {
        if (!hasDetail || e.target.closest("button")) return;
        const now = !expanded.has(item.id);
        if (now) expanded.add(item.id);
        else expanded.delete(item.id);
        caret.textContent = now ? "▾" : "▸";
        details.forEach((d) => (d.hidden = !now));
      },
    },
    el(
      "td",
      {},
      caret,
      el("span", { class: "fin-acc-name" }, item.name),
      item.category ? el("span", { class: "fin-acc-meta" }, `　${item.category}`) : null
    ),
    el("td", { class: "num" }, money(item.amount_minor)),
    el(
      "td",
      { class: item.overdue ? "fin-stale" : "fin-acc-meta" },
      item.target_month ? item.target_month : "未定",
      item.overdue ? "（已過）" : ""
    ),
    el(
      "td",
      { class: "wish-actions" },
      el(
        "button",
        { class: "btn btn-sm", type: "button", onclick: () => closeWish(item, "bought", reload) },
        "買了"
      ),
      el(
        "button",
        {
          class: "btn btn-sm",
          type: "button",
          title: "更多",
          onclick: (e) => wishMenu(e.currentTarget, item, reload),
        },
        "⋯"
      )
    )
  );
  return [row, ...details];
}

function closedTable(closed, reload) {
  return el(
    "div",
    { class: "fin-table-wrap" },
    el(
      "table",
      { class: "fin-table fin-closed" },
      el(
        "tbody",
        {},
        ...closed.map((i) =>
          el(
            "tr",
            {},
            el("td", {}, i.name),
            el("td", { class: "num" }, money(i.amount_minor)),
            el("td", { class: "fin-acc-meta" }, `${i.status === "bought" ? "買了" : "不買了"}・${i.closed_on}`),
            el(
              "td",
              {},
              el(
                "button",
                {
                  class: "btn btn-sm",
                  type: "button",
                  onclick: async () => {
                    await api.reopenWish(i.id);
                    toast("已放回清單");
                    reload();
                  },
                },
                "放回清單"
              )
            )
          )
        )
      )
    )
  );
}

function wishMenu(anchor, item, reload) {
  const act = (fn) => () => {
    menu.remove();
    dispose();
    fn();
  };
  const menu = el(
    "div",
    { class: "popover row-menu" },
    el("button", { class: "menu-item", type: "button", onclick: act(() => editWish(item, reload)) }, "編輯"),
    el(
      "button",
      { class: "menu-item", type: "button", onclick: act(() => closeWish(item, "dropped", reload)) },
      "不買了"
    ),
    el("div", { class: "menu-sep" }),
    el(
      "button",
      {
        class: "menu-item danger",
        type: "button",
        onclick: act(async () => {
          const ok = await confirmBox(
            `刪除「${item.name}」？`,
            "只在建錯時用；不想買了請用「不買了」，以後還看得到。",
            "刪除"
          );
          if (!ok) return;
          await api.deleteWish(item.id);
          toast("已刪除");
          reload();
        }),
      },
      "刪除（建錯了）"
    )
  );
  positionPopover(menu, anchor);
  const dispose = onClickOutside(menu, () => {
    menu.remove();
    dispose();
  });
}

async function closeWish(item, status, reload) {
  try {
    await api.closeWish(item.id, status);
    toast(
      status === "bought"
        ? "已標成買了。記得到帳戶「改餘額」，總資產才會反映這筆"
        : "已移到「已完成」"
    );
    reload();
  } catch (err) {
    toast(err.message, true);
  }
}

/* --- 對話框 ----------------------------------------------------------- */

const WHEN = [
  { value: "0", label: "本月" },
  { value: "1", label: "下個月" },
  { value: "3", label: "3 個月後" },
  { value: "6", label: "半年後" },
  { value: "12", label: "一年後" },
  { value: "none", label: "還不確定" },
  { value: "custom", label: "指定月份…" },
];

async function editWish(item, reload) {
  const cats = (await api.cashflowCategories()).filter((c) => c.kind === "expense");
  const thisMonth = localDate().slice(0, 7);

  const name = textField("想買什麼", item?.name || "", "例如「日本旅行」「新筆電」");
  const category = selectField(
    "類別",
    [{ value: "", label: "（不分類）" }, ...cats.map((c) => ({ value: c.id, label: c.name }))],
    item?.category_id ?? ""
  );
  const when = selectField(
    "預計什麼時候",
    WHEN,
    item ? (item.target_month ? "custom" : "none") : "1",
    "一個月內算短期、半年內算中期，時間到了會自己往前移"
  );
  const custom = el("input", { type: "month", value: item?.target_month || thisMonth });
  const customNode = el("div", { class: "field" }, custom);
  const toggle = () => {
    customNode.hidden = when.select.value !== "custom";
  };
  when.select.addEventListener("change", toggle);
  toggle();

  const list = el("div", { class: "budget-lines" });
  const total = el("span", { class: "budget-subtotal" });
  const lines = [];
  const update = () => {
    const sum = lines.reduce((s, l) => s + (parseAmount(l.amount.value) || 0), 0);
    total.textContent = `合計 ${fmt.format(sum)}`;
  };
  const addLine = (label = "", amount = "", focus = false) => {
    const labelInput = el("input", { type: "text", value: label, placeholder: "細項（選填，例如機票）", class: "budget-label" });
    const amountInput = el("input", { type: "text", inputmode: "decimal", value: amount, placeholder: "價格", class: "budget-amount" });
    amountInput.addEventListener("input", update);
    const line = { label: labelInput, amount: amountInput };
    const node = el(
      "div",
      { class: "budget-line" },
      labelInput,
      amountInput,
      el(
        "button",
        {
          class: "chip-x",
          type: "button",
          title: "刪掉這項",
          onclick: () => {
            lines.splice(lines.indexOf(line), 1);
            node.remove();
            update();
          },
        },
        "×"
      )
    );
    lines.push(line);
    list.append(node);
    update();
    if (focus) labelInput.focus();
  };
  (item?.lines.length ? item.lines : [{ label: "", amount_minor: null }]).forEach((l) =>
    addLine(l.label, l.amount_minor === null ? "" : plain(l.amount_minor))
  );

  const linesBlock = el(
    "div",
    { class: "budget-block" },
    el(
      "div",
      { class: "budget-head" },
      el("strong", {}, "價格"),
      el("span", { class: "fin-acc-meta" }, "只有一個價格就填一行"),
      el("span", { class: "spacer" }),
      total,
      el("button", { class: "link-btn", type: "button", onclick: () => addLine("", "", true) }, "+ 一項")
    ),
    list
  );

  modal({
    title: item ? `編輯：${item.name}` : "加到慾望清單",
    wide: true,
    fields: [name.node, category.node, when.node, customNode, linesBlock],
    confirmLabel: item ? "儲存" : "加入",
    onConfirm: async () => {
      const value = name.input.value.trim();
      if (!value) throw new Error("請填想買什麼");
      const rows = [];
      for (const l of lines) {
        const label = l.label.value.trim();
        const amount = l.amount.value.trim();
        if (!label && !amount) continue;
        if (!amount || Number.isNaN(parseAmount(amount))) {
          throw new Error(`「${label || "價格"}」需要金額`);
        }
        rows.push({ label, amount });
      }
      if (!rows.length) throw new Error("至少填一個價格");

      const choice = when.select.value;
      const target =
        choice === "none"
          ? null
          : choice === "custom"
            ? custom.value || thisMonth
            : addMonths(thisMonth, Number(choice));
      const body = {
        name: value,
        category_id: category.select.value || null,
        target_month: target,
        lines: rows,
      };
      if (item) await api.updateWish(item.id, body);
      else await api.createWish(body);
      toast(item ? "已更新" : "已加入");
      await reload();
    },
  });
}
