/* 每月收支：固定項目、變動花費預算、可支配金額。 */

import { api } from "../api.js";
import { el, localDate, onClickOutside, positionPopover, toast } from "../util.js";
import { confirmBox, modal, selectField, textField } from "../dialog.js";

const fmt = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 });
const money = (minor) => (minor === null || minor === undefined ? "—" : fmt.format(minor / 100));
const pct = (ratio) => {
  if (ratio === null || ratio === undefined) return "—";
  if (ratio > 0 && ratio < 0.005) return "<1%";
  return `${Math.round(ratio * 100)}%`;
};
const plain = (minor) => String(Math.round(minor) / 100);

const PERIODS = [
  { value: "month", label: "每月" },
  { value: "quarter", label: "每季" },
  { value: "year", label: "每年" },
];
const PERIOD_LABEL = Object.fromEntries(PERIODS.map((p) => [p.value, p.label]));
const MONTHS = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1} 月` }));

const thisMonth = () => localDate().slice(0, 7);
const view = { month: thisMonth(), expanded: new Set() };

function monthField(label, value, hint) {
  const input = el("input", { type: "month", value });
  return {
    input,
    node: el(
      "div",
      { class: "field" },
      el("label", {}, label),
      input,
      hint ? el("span", { class: "field-hint" }, hint) : null
    ),
  };
}

function card(label, minor, cls = "", sub = null) {
  return el(
    "div",
    { class: `fin-card ${cls}` },
    el("div", { class: "fin-card-label" }, label),
    el("div", { class: "fin-card-value" }, money(minor)),
    sub ? el("div", { class: "fin-acc-meta" }, sub) : null
  );
}

export async function renderCashflow(mount, toolbarExtras) {
  const reload = () => renderCashflow(mount, toolbarExtras);
  const [data, cats] = await Promise.all([
    api.cashflow(view.month),
    api.cashflowCategories(),
  ]);

  const monthInput = el("input", { type: "month", value: view.month, class: "fin-date" });
  monthInput.addEventListener("change", () => {
    view.month = monthInput.value || thisMonth();
    reload();
  });

  const toolbar = el(
    "div",
    { class: "fin-toolbar" },
    ...toolbarExtras,
    el("label", { class: "fin-date-label" }, "月份 ", monthInput),
    el("div", { class: "spacer" }),
    el(
      "button",
      { class: "btn btn-sm", type: "button", onclick: () => editItem(null, cats, reload) },
      "+ 固定項目"
    ),
    el(
      "button",
      { class: "btn btn-sm btn-primary", type: "button", onclick: () => editBudgets(data, reload) },
      "更新預算"
    )
  );

  if (!data.items.length && !data.variable_minor) {
    mount.replaceChildren(
      toolbar,
      el(
        "div",
        { class: "empty-state" },
        el("h2", {}, "還沒有任何收支"),
        el("p", {}, "按「+ 固定項目」加入月薪、房租、訂閱、保險；按「更新預算」估計每月吃飯、交通等變動花費。")
      )
    );
    return;
  }

  const cards = el(
    "div",
    { class: "fin-summary" },
    el(
      "div",
      { class: "fin-cards fin-cards-main" },
      card("實領收入（月均）", data.income_minor),
      card("固定支出（月均）", data.fixed_expense_minor, "fin-neg"),
      card(
        "定期投資（月均）",
        data.invest_minor ?? 0,
        "fin-invest",
        data.invest_minor ? `占收入 ${pct(data.income_minor ? data.invest_minor / data.income_minor : null)}` : "這個月沒有"
      )
    ),
    el(
      "div",
      { class: "fin-cards fin-cards-main" },
      card("可支配金額", data.disposable_minor, "fin-net", [
        "收入 − 固定支出 − ",
        el("span", { class: "fin-invest" }, "定期投資"),
      ]),
      card("變動花費預算", data.variable_minor, "fin-neg"),
      card(
        "每月留在現金",
        data.cash_left_minor ?? data.savings_minor,
        (data.cash_left_minor ?? data.savings_minor) < 0 ? "fin-neg" : "",
        "可支配 − 變動預算"
      )
    ),
    // 投資自動扣走、不能拿來花，但它是存下來的錢，淨資產照樣增加
    el(
      "div",
      { class: "fin-cards fin-cards-main" },
      card(
        "每月共存下",
        data.savings_minor,
        data.savings_minor < 0 ? "fin-neg" : "",
        data.invest_minor
          ? ["留在現金 ＋ ", el("span", { class: "fin-invest" }, "定期投資")]
          : "目前都留在現金"
      ),
      el(
        "div",
        { class: "fin-card" },
        el("div", { class: "fin-card-label" }, "儲蓄率"),
        el("div", { class: "fin-card-value" }, pct(data.savings_rate)),
        el("div", { class: "fin-acc-meta" }, "每月共存下 ÷ 實領收入")
      )
    )
  );

  const lumpy = data.lumpy.length
    ? el(
        "p",
        { class: "fin-warn" },
        `這個月另有：${data.lumpy.map((i) => `${i.name} ${money(i.amount_minor)}`).join("、")}。` +
          `本月實際進帳 ${money(data.due_income_minor)}，支出約 ${money(data.due_expense_minor)}`,
        data.due_invest_minor
          ? ["，", el("span", { class: "fin-invest" }, `投資 ${money(data.due_invest_minor)}`)]
          : null,
        "。"
      )
    : null;

  mount.replaceChildren(
    toolbar,
    cards,
    lumpy || "",
    categoryTable(data, () => editBudgets(data, reload)),
    itemsTable(data, cats, reload)
  );
}

function categoryTable(data, onBudget) {
  // 定期投資不是支出，但使用者要在這裡看到錢流向哪裡；排在最後並註明
  const rows = data.categories.filter((c) => c.kind !== "income" && c.total_minor);
  if (!rows.length) return "";
  // 還沒填變動預算時，「變動」全空、「合計」等於「固定」，只會讓人以為重複了
  const hasBudget = data.variable_minor > 0;
  return el(
    "section",
    { class: "fin-history" },
    el("h2", {}, "每月的錢去哪裡"),
    hasBudget
      ? null
      : el(
          "p",
          { class: "fin-note" },
          "目前只有固定項目。吃飯、交通、購物這類每月不固定的花費，",
          el("button", { class: "link-btn", type: "button", onclick: onBudget }, "填一份變動預算"),
          " 後會加在這裡一起算。"
        ),
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
            el("th", {}, "類別"),
            el("th", { class: "num" }, "固定"),
            hasBudget ? el("th", { class: "num" }, "變動預算") : null,
            hasBudget ? el("th", { class: "num" }, "合計") : null,
            el("th", { class: "num" }, "占收入")
          )
        ),
        el(
          "tbody",
          {},
          ...rows.flatMap((c) => {
            const details = categoryDetails(data, c, hasBudget);
            const open = view.expanded.has(c.id);
            details.forEach((d) => (d.hidden = !open));
            const caret = el("span", { class: "fin-caret" }, open ? "▾" : "▸");
            const row = el(
              "tr",
              {
                class: c.kind === "invest" ? "fin-expandable fin-invest" : "fin-expandable",
                title: "點一下看細項",
                onclick: () => {
                  const nowOpen = !view.expanded.has(c.id);
                  if (nowOpen) view.expanded.add(c.id);
                  else view.expanded.delete(c.id);
                  caret.textContent = nowOpen ? "▾" : "▸";
                  details.forEach((d) => (d.hidden = !nowOpen));
                },
              },
              el(
                "td",
                {},
                caret,
                c.name,
                c.kind === "invest" ? el("span", { class: "fin-acc-meta" }, "　不算支出") : null
              ),
              el("td", { class: "num" }, c.fixed_minor ? money(c.fixed_minor) : ""),
              hasBudget
                ? el(
                    "td",
                    { class: "num", title: c.budget_as_of ? `${c.budget_as_of} 估的` : "" },
                    c.variable_minor ? money(c.variable_minor) : ""
                  )
                : null,
              hasBudget ? el("td", { class: "num" }, money(c.total_minor)) : null,
              el("td", { class: "num" }, pct(c.share_of_income))
            );
            return [row, ...details];
          })
        )
      )
    )
  );
}

/** 展開後的細項：這個類別的每個固定項目，以及變動預算那一列。 */
function categoryDetails(data, c, hasBudget) {
  const share = (minor) => (data.income_minor ? pct(minor / data.income_minor) : "—");
  const detail = (label, meta, fixed, variable) =>
    el(
      "tr",
      { class: c.kind === "invest" ? "fin-detail fin-invest" : "fin-detail" },
      el("td", {}, label, meta ? el("span", { class: "fin-acc-meta" }, `　${meta}`) : null),
      el("td", { class: "num" }, fixed ? money(fixed) : ""),
      hasBudget ? el("td", { class: "num" }, variable ? money(variable) : "") : null,
      hasBudget ? el("td", {}) : null,
      el("td", { class: "num" }, share(fixed || variable))
    );

  const rows = data.items
    .filter((i) => i.category_id === c.id)
    .map((i) =>
      detail(
        i.name,
        i.period === "month"
          ? null
          : `${PERIOD_LABEL[i.period]} ${money(i.amount_minor)}${i.due_month ? `・${i.due_month} 月扣款` : ""}`,
        i.monthly_minor,
        0
      )
    );
  const asOf = c.budget_as_of ? `${c.budget_as_of} 估的` : null;
  const budgetLines = c.budget_lines || [];
  if (budgetLines.length) {
    budgetLines.forEach((l, i) =>
      rows.push(detail(l.label || "（未命名）", i === 0 ? `變動・${asOf}` : "變動", 0, l.amount_minor))
    );
  } else if (c.variable_minor) {
    rows.push(detail("變動預算", asOf, 0, c.variable_minor));
  }
  return rows;
}

function itemsTable(data, cats, reload) {
  if (!data.items.length) return "";
  const catName = Object.fromEntries(cats.map((c) => [c.id, c.name]));
  const section = (title, items) =>
    items.length
      ? [
          el(
            "tr",
            { class: items[0].kind === "invest" ? "fin-group fin-invest" : "fin-group" },
            el("td", { colspan: "5" }, title)
          ),
          ...items.map((i) =>
            el(
              "tr",
              { class: i.kind === "invest" ? "fin-invest" : "" },
              el(
                "td",
                {},
                el("div", { class: "fin-acc-name" }, i.name),
                el("div", { class: "fin-acc-meta" }, catName[i.category_id] || "")
              ),
              el(
                "td",
                { class: "num" },
                `${PERIOD_LABEL[i.period]} ${money(i.amount_minor)}`,
                i.period !== "month" && i.due_month
                  ? el("div", { class: "fin-acc-meta" }, `${i.due_month} 月扣款`)
                  : null
              ),
              el("td", { class: `num ${i.kind === "expense" ? "fin-neg" : ""}` }, money(i.monthly_minor)),
              el(
                "td",
                { class: "fin-acc-meta" },
                `${i.start_month} 起`,
                i.end_month ? `，到 ${i.end_month}` : ""
              ),
              el(
                "td",
                {},
                el(
                  "button",
                  {
                    class: "btn btn-sm",
                    type: "button",
                    onclick: (e) => itemMenu(e.currentTarget, i, cats, reload),
                  },
                  "⋯"
                )
              )
            )
          ),
        ]
      : [];

  return el(
    "section",
    { class: "fin-history" },
    el("h2", {}, `${data.month} 的固定項目`),
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
            el("th", { class: "num" }, "月均"),
            el("th", {}, "期間"),
            el("th", {}, "")
          )
        ),
        el(
          "tbody",
          {},
          ...section("收入", data.items.filter((i) => i.kind === "income")),
          ...section("支出", data.items.filter((i) => i.kind === "expense")),
          ...section("定期投資", data.items.filter((i) => i.kind === "invest"))
        )
      )
    )
  );
}

function itemMenu(anchor, item, cats, reload) {
  const act = (fn) => () => {
    menu.remove();
    dispose();
    fn();
  };
  const menu = el(
    "div",
    { class: "popover row-menu" },
    el("button", { class: "menu-item", type: "button", onclick: act(() => adjustItem(item, reload)) }, "改金額"),
    el("button", { class: "menu-item", type: "button", onclick: act(() => editItem(item, cats, reload)) }, "編輯（名稱、類別、扣款月）"),
    el("button", { class: "menu-item", type: "button", onclick: act(() => stopItem(item, reload)) }, "停止（不再付）"),
    el("div", { class: "menu-sep" }),
    el("button", { class: "menu-item danger", type: "button", onclick: act(() => deleteItem(item, reload)) }, "刪除（建錯了）")
  );
  positionPopover(menu, anchor);
  const dispose = onClickOutside(menu, () => {
    menu.remove();
    dispose();
  });
}

/* --- 對話框 ----------------------------------------------------------- */

const KIND_LABEL = { income: "收入", expense: "支出", invest: "投資" };

function categoryOptions(cats, kind) {
  return cats
    .filter((c) => !kind || c.kind === kind)
    .map((c) => ({ value: c.id, label: `${KIND_LABEL[c.kind] || c.kind}・${c.name}` }));
}

/** 新增，或只改名稱／類別。金額另走「改金額」，才不會改掉過去的月份。 */
function editItem(item, cats, reload) {
  const name = textField(
    "名稱",
    item?.name || "",
    "例如「月薪」「房租」「Netflix」「壽險年繳」「0050 定期定額」"
  );
  const category = selectField(
    "類別",
    categoryOptions(cats, item?.kind),
    item?.category_id ?? cats.find((c) => c.kind === "expense")?.id
  );
  if (item) {
    const due =
      item.period === "month"
        ? null
        : selectField(
            "哪個月扣款",
            MONTHS,
            item.due_month ?? Number(item.start_month.slice(5, 7)),
            item.period === "quarter" ? "填一年中第一次扣款的月份" : null
          );
    modal({
      title: "編輯項目",
      fields: [name.node, category.node, due?.node],
      confirmLabel: "儲存",
      onConfirm: async () => {
        await api.updateCashflowItem(item.id, {
          name: name.input.value.trim(),
          category_id: category.select.value,
          ...(due ? { due_month: Number(due.select.value) } : {}),
        });
        toast("已更新");
        await reload();
      },
    });
    return;
  }

  const amount = textField("金額", "", "收入填實領（扣完勞健保、所得稅、勞退自提後入帳的數字）");
  amount.input.setAttribute("inputmode", "decimal");
  const period = selectField("週期", PERIODS, "month");
  const start = monthField("從哪個月開始", thisMonth());
  const due = selectField(
    "哪個月扣款",
    MONTHS,
    Number(thisMonth().slice(5, 7)),
    "預設跟開始月份相同；季繳填一年中第一次扣款的月份"
  );
  // 沒動過扣款月之前，跟著開始月份走；否則選了六月開始卻留著預設的本月
  let dueTouched = false;
  due.select.addEventListener("change", () => {
    dueTouched = true;
  });
  start.input.addEventListener("change", () => {
    if (!dueTouched && start.input.value) due.select.value = String(Number(start.input.value.slice(5, 7)));
  });
  const toggleDue = () => {
    due.node.hidden = period.select.value === "month";
  };
  period.select.addEventListener("change", toggleDue);
  toggleDue();

  modal({
    title: "新增固定項目",
    fields: [name.node, category.node, amount.node, period.node, start.node, due.node],
    confirmLabel: "建立",
    onConfirm: async () => {
      const value = name.input.value.trim();
      if (!value) throw new Error("請輸入名稱");
      if (!amount.input.value.trim()) throw new Error("請輸入金額");
      await api.createCashflowItem({
        name: value,
        category_id: category.select.value,
        amount: amount.input.value.trim(),
        period: period.select.value,
        due_month: period.select.value === "month" ? null : Number(due.select.value),
        start_month: start.input.value || thisMonth(),
      });
      toast("已建立");
      await reload();
    },
  });
}

function adjustItem(item, reload) {
  const amount = textField(`新金額（${PERIOD_LABEL[item.period]}）`, plain(item.amount_minor));
  amount.input.setAttribute("inputmode", "decimal");
  const when = monthField(
    "從哪個月起",
    thisMonth(),
    "之前的月份維持舊金額。填開始的那個月就是直接更正。"
  );
  modal({
    title: `改金額：${item.name}`,
    fields: [amount.node, when.node],
    confirmLabel: "儲存",
    onConfirm: async () => {
      await api.adjustCashflowItem(item.id, {
        amount: amount.input.value.trim(),
        effective_month: when.input.value || thisMonth(),
      });
      toast("已更新");
      await reload();
    },
  });
}

function stopItem(item, reload) {
  const last = monthField("最後一次付款（或入帳）的月份", thisMonth(), "之後的月份就不再算這筆");
  modal({
    title: `停止：${item.name}`,
    fields: [last.node],
    confirmLabel: "停止",
    onConfirm: async () => {
      await api.stopCashflowItem(item.id, last.input.value || thisMonth());
      toast("已停止");
      await reload();
    },
  });
}

async function deleteItem(item, reload) {
  const ok = await confirmBox(
    `刪除「${item.name}」？`,
    "只在建錯時用。真的不再付了請用「停止」，過去的月份才會留著。",
    "刪除"
  );
  if (!ok) return;
  try {
    await api.deleteCashflowItem(item.id);
    toast("已刪除");
    await reload();
  } catch (err) {
    toast(err.message, true);
  }
}

const parseAmount = (text) => Number(String(text).replace(/,/g, "").trim());

/**
 * 變動花費的預算估計，記在「今天」。每個類別底下列出估了哪些細項，
 * 類別的預算就是細項加總。
 *
 * 預填上次的估計，只改想調整的；沒動過的類別不送出（沿用上次）。
 * 把某類別的細項全部刪掉，就是把它歸零。
 */
function editBudgets(data, reload) {
  const date = el("input", { type: "date", value: localDate() });

  const blocks = data.categories
    .filter((c) => c.kind === "expense")
    .map((c) => {
      const budgetLines = c.budget_lines || [];
      const initial = budgetLines.length
        ? budgetLines.map((l) => ({ label: l.label, amount: plain(l.amount_minor) }))
        : c.variable_minor
          ? [{ label: "", amount: plain(c.variable_minor) }]
          : [];
      const list = el("div", { class: "budget-lines" });
      const subtotal = el("span", { class: "budget-subtotal" });
      const lines = [];

      const update = () => {
        const sum = lines.reduce((s, l) => s + (parseAmount(l.amount.value) || 0), 0);
        subtotal.textContent = lines.length ? `小計 ${fmt.format(sum)}` : "";
      };
      const addLine = (label = "", amount = "", focus = false) => {
        const labelInput = el("input", {
          type: "text",
          value: label,
          placeholder: "估了什麼（例如請爸媽吃飯）",
          class: "budget-label",
        });
        const amountInput = el("input", {
          type: "text",
          inputmode: "decimal",
          value: amount,
          placeholder: "金額",
          class: "budget-amount",
        });
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
      initial.forEach((l) => addLine(l.label, l.amount));

      const snapshot = () =>
        JSON.stringify(lines.map((l) => [l.label.value.trim(), l.amount.value.trim()]));
      const before = snapshot();

      return {
        c,
        lines,
        changed: () => snapshot() !== before,
        node: el(
          "div",
          { class: "budget-block" },
          el(
            "div",
            { class: "budget-head" },
            el("strong", {}, c.name),
            c.fixed_minor ? el("span", { class: "fin-acc-meta" }, `另有固定 ${money(c.fixed_minor)}`) : null,
            el("span", { class: "spacer" }),
            subtotal,
            el(
              "button",
              { class: "link-btn", type: "button", onclick: () => addLine("", "", true) },
              "+ 一項"
            )
          ),
          list
        ),
      };
    });

  modal({
    title: "更新變動花費預算",
    wide: true,
    fields: [
      el("div", { class: "field" }, el("label", {}, "這份估計從哪天起"), date),
      el(
        "p",
        { class: "field-hint" },
        "每月大概會花多少、不含已列的固定項目。每類可以列出估了哪些，加總就是那一類的預算。" +
          "已帶入上次的估計，沒動過的類別沿用上次；刪光某類的細項就是歸零。"
      ),
      el("div", { class: "budget-blocks" }, ...blocks.map((b) => b.node)),
    ],
    confirmLabel: "存檔",
    onConfirm: async () => {
      const rows = [];
      for (const b of blocks.filter((b) => b.changed())) {
        const lines = [];
        for (const l of b.lines) {
          const label = l.label.value.trim();
          const amount = l.amount.value.trim();
          if (!label && !amount) continue;
          if (!amount || Number.isNaN(parseAmount(amount))) {
            throw new Error(`「${b.c.name}」的「${label || "未命名"}」需要金額`);
          }
          lines.push({ label, amount });
        }
        rows.push({ category_id: b.c.id, lines });
      }
      if (!rows.length) throw new Error("沒有任何變動");
      await api.saveCashflowBudgets({ as_of: date.value || localDate(), rows });
      view.month = thisMonth();
      toast("已存檔");
      await reload();
    },
  });
}
