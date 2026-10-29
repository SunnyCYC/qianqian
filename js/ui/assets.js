/* 資產總覽：截至某日的總覽、盤點、帳戶管理。 */

import { api } from "../api.js";
import { el, localDate, toast } from "../util.js";
import { renderCashflow } from "./cashflow.js";
import { wishCards, wishSection } from "./wishlist.js";
import { confirmBox, modal, selectField, textField } from "../dialog.js";

const CURRENCIES = ["TWD", "USD", "EUR", "JPY", "CNY", "HKD", "GBP", "AUD"];

const fmt = new Intl.NumberFormat("zh-TW", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** 整數最小單位 → 顯示字串。null 代表「算不出來」，不是 0。 */
const money = (minor) => (minor === null || minor === undefined ? "—" : fmt.format(minor / 100));

/** 盤點表的預填值：不帶千分位，免得使用者改一位數還要繞過逗號 */
const plain = (minor) => {
  const value = minor / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
};

const view = { on: localDate(), mode: "assets" };

function modeSwitch(mount) {
  const button = (mode, label) =>
    el(
      "button",
      {
        type: "button",
        class: view.mode === mode ? "active" : "",
        onclick: () => {
          if (view.mode === mode) return;
          view.mode = mode;
          renderFinance(mount);
        },
      },
      label
    );
  return el("div", { class: "fin-switch" }, button("assets", "資產總覽"), button("cashflow", "每月收支"));
}

function emptyState(title, body) {
  return el("div", { class: "empty-state" }, el("h2", {}, title), el("p", {}, body));
}

function summaryCards(data) {
  const used = data.classes.filter((c) =>
    data.accounts.some((a) => a.cells[c.id])
  );
  const card = (label, minor, cls = "") =>
    el(
      "div",
      { class: `fin-card ${cls}` },
      el("div", { class: "fin-card-label" }, label),
      el("div", { class: "fin-card-value" }, money(minor))
    );
  return el(
    "div",
    { class: "fin-summary" },
    el(
      "div",
      { class: "fin-cards fin-cards-main" },
      card("資產", data.assets_minor),
      card("負債", data.liabilities_minor, "fin-neg"),
      card(`淨資產（${data.base_currency}）`, data.net_minor, "fin-net")
    ),
    el(
      "div",
      { class: "fin-cards" },
      ...used.map((c) =>
        card(c.name, data.class_totals[c.id], c.is_liability ? "fin-neg" : "")
      )
    )
  );
}

function notices(data) {
  const items = [];
  if (data.missing_rates.length) {
    items.push(
      `沒有 ${data.missing_rates.join("、")} 的匯率，這些帳戶沒有算進總額。按「更新所有餘額」補上匯率。`
    );
  }
  const rates = Object.entries(data.rates);
  if (rates.length) {
    items.push(
      "匯率：" +
        rates
          .map(([cur, r]) => `1 ${cur} = ${Number(r.rate)} ${data.base_currency}（${r.as_of}${r.source === "auto" ? "，自動" : "，手動"}）`)
          .join("　")
    );
  }
  return items.map((text, i) =>
    el("p", { class: i === 0 && data.missing_rates.length ? "fin-warn" : "fin-note" }, text)
  );
}

function accountsTable(data, reload) {
  const used = data.classes.filter((c) =>
    data.accounts.some((a) => a.cells[c.id])
  );
  const head = el(
    "tr",
    {},
    el("th", {}, "帳戶"),
    ...used.map((c) => el("th", { class: "num" }, c.name)),
    el("th", { class: "num" }, `小計（${data.base_currency}）`),
    el("th", {}, "最後更新"),
    el("th", {}, "")
  );

  const rows = data.accounts.map((acc) => {
    const foreign = acc.currency !== data.base_currency;
    const age =
      acc.days_old === null
        ? "還沒記過"
        : acc.days_old === 0
          ? "今天"
          : `${acc.days_old} 天前`;
    return el(
      "tr",
      { class: acc.is_active ? "" : "fin-closed" },
      el(
        "td",
        {},
        el("div", { class: "fin-acc-name" }, acc.name, acc.is_active ? null : "（已關閉）"),
        el(
          "div",
          { class: "fin-acc-meta" },
          [acc.institution, acc.currency].filter(Boolean).join(" · ")
        )
      ),
      ...used.map((c) => {
        const cell = acc.cells[c.id];
        if (!cell) return el("td", { class: "num fin-empty", "data-label": c.name }, "");
        return el(
          "td",
          {
            class: `num ${c.is_liability ? "fin-neg" : ""}`,
            "data-label": c.name,
            title: `${cell.as_of} 的數字`,
          },
          foreign ? `${acc.currency} ${money(cell.amount_minor)}` : money(cell.amount_minor),
          foreign ? el("div", { class: "fin-acc-meta" }, `≈ ${money(cell.base_minor)}`) : null
        );
      }),
      el(
        "td",
        { class: "num", "data-label": "小計" },
        acc.days_old === null && acc.is_active
          ? el(
              "button",
              { class: "btn btn-sm btn-primary", type: "button", onclick: () => openSnapshot(reload, acc.id) },
              "填入餘額"
            )
          : money(acc.net_base_minor)
      ),
      el("td", { class: acc.stale ? "fin-stale" : "fin-acc-meta" }, age),
      el(
        "td",
        { class: "wish-actions" },
        acc.is_active && acc.days_old !== null
          ? el(
              "button",
              { class: "btn btn-sm", type: "button", onclick: () => openSnapshot(reload, acc.id) },
              "改餘額"
            )
          : null,
        acc.is_active
          ? el(
              "button",
              {
                class: "btn btn-sm",
                type: "button",
                title: "改名稱、銀行，或關閉帳戶",
                onclick: () => editAccount(acc, reload),
              },
              "⋯"
            )
          : null
      )
    );
  });

  return el(
    "div",
    { class: "fin-table-wrap" },
    el("table", { class: "fin-table" }, el("thead", {}, head), el("tbody", {}, ...rows))
  );
}

function historyTable(rows, onPick) {
  if (!rows.length) return null;
  return el(
    "section",
    { class: "fin-history" },
    el("h2", {}, "歷次盤點"),
    el(
      "p",
      { class: "fin-note" },
      "變化包含存入與提領，不等於投資報酬。"
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
            el("th", {}, "截至"),
            el("th", { class: "num" }, "資產"),
            el("th", { class: "num" }, "負債"),
            el("th", { class: "num" }, "淨資產"),
            el("th", { class: "num" }, "較前次")
          )
        ),
        el(
          "tbody",
          {},
          ...rows.map((r) =>
            el(
              "tr",
              {},
              el(
                "td",
                {},
                el(
                  "button",
                  { class: "link-btn", type: "button", onclick: () => onPick(r.as_of) },
                  r.as_of
                )
              ),
              el("td", { class: "num" }, money(r.assets_minor)),
              el("td", { class: "num fin-neg" }, money(r.liabilities_minor)),
              el("td", { class: "num" }, money(r.net_minor)),
              el(
                "td",
                {
                  class: `num ${r.change_minor > 0 ? "score-pos" : r.change_minor < 0 ? "score-neg" : ""}`,
                },
                r.change_minor === null
                  ? "—"
                  : `${r.change_minor > 0 ? "+" : ""}${money(r.change_minor)}`
              )
            )
          )
        )
      )
    )
  );
}

export async function renderFinance(mount) {
  if (view.mode === "cashflow") return renderCashflow(mount, [modeSwitch(mount)]);
  const reload = () => renderFinance(mount);
  const [data, history, wishes] = await Promise.all([
    api.financeOverview(view.on),
    api.financeHistory(),
    api.wishlist().catch(() => null),
  ]);

  const dateInput = el("input", { type: "date", value: view.on, class: "fin-date" });
  dateInput.addEventListener("change", () => {
    view.on = dateInput.value || localDate();
    reload();
  });

  const toolbar = el(
    "div",
    { class: "fin-toolbar" },
    modeSwitch(mount),
    el("label", { class: "fin-date-label" }, "截至 ", dateInput),
    view.on !== localDate()
      ? el(
          "button",
          {
            class: "btn btn-sm",
            type: "button",
            onclick: () => {
              view.on = localDate();
              reload();
            },
          },
          "今天"
        )
      : null,
    el("div", { class: "spacer" }),
    el("button", { class: "btn btn-sm", type: "button", onclick: () => addAccount(reload) }, "+ 帳戶"),
    data.accounts.some((a) => a.is_active)
      ? el(
          "button",
          {
            class: "btn btn-sm btn-primary",
            type: "button",
            title: "一次更新所有帳戶的餘額，例如每個月底盤點一次",
            onclick: () => openSnapshot(reload),
          },
          "更新所有餘額"
        )
      : null
  );

  if (!data.accounts.length) {
    mount.replaceChildren(toolbar, gettingStarted(reload));
    return;
  }

  // 清單是「現在的計畫」，拿去扣過去某天的資產沒有意義
  const isToday = view.on === localDate();
  mount.replaceChildren(
    toolbar,
    summaryCards(data),
    (isToday && wishCards(wishes)) || "",
    ...notices(data),
    accountsTable(data, reload),
    wishSection(wishes, reload),
    historyTable(history, (day) => {
      view.on = day;
      reload();
    }) || ""
  );
}

/* --- 帳戶 ------------------------------------------------------------- */

/** 還沒有帳戶時的說明：帳戶是什麼、接著要做什麼。 */
function gettingStarted(reload) {
  const step = (n, title, body) =>
    el("li", { class: "start-step" }, el("strong", {}, `${n}. ${title}`), el("div", { class: "fin-acc-meta" }, body));
  return el(
    "div",
    { class: "start-guide" },
    el("h2", {}, "先把錢放在哪裡記下來"),
    el(
      "ol",
      {},
      step(1, "新增帳戶", "一個帳戶 = 一個放錢的地方，例如「郵局」「國泰世華」「元大證券」「錢包現金」。"),
      step(2, "填入餘額", "寫下這個帳戶裡現在有多少錢：活存填在「現金」，定存、股票、基金各填各的；信用卡這期要繳的填在「信用卡未繳」。"),
      step(3, "之後偶爾更新", "例如每個月底按「更新所有餘額」，改有變動的數字就好，就能看到資產的變化。")
    ),
    el("button", { class: "btn btn-primary", type: "button", onclick: () => addAccount(reload) }, "+ 新增第一個帳戶")
  );
}

function addAccount(reload) {
  const name = textField("帳戶名稱", "", "放錢的地方，例如「郵局」「國泰世華」「元大證券」「錢包」");
  const institution = textField("銀行／券商", "", "選填，只是備註");
  const currency = selectField(
    "幣別",
    CURRENCIES.map((c) => ({ value: c, label: c })),
    "TWD",
    "一般台幣帳戶不用改。建立後不能改"
  );
  modal({
    title: "新增帳戶",
    fields: [name.node, institution.node, currency.node],
    confirmLabel: "下一步：填入餘額",
    onConfirm: async () => {
      const value = name.input.value.trim();
      if (!value) throw new Error("請輸入帳戶名稱");
      const acc = await api.createFinanceAccount({
        name: value,
        institution: institution.input.value.trim() || null,
        currency: currency.select.value,
      });
      await reload();
      // 建完馬上填，否則使用者面對一列「0、還沒記過」不知道接著要做什麼
      setTimeout(() => openSnapshot(reload, acc.id), 0);
    },
  });
}

function editAccount(acc, reload) {
  const name = textField("帳戶名稱", acc.name);
  const institution = textField("銀行／券商", acc.institution || "");
  const close = el(
    "button",
    {
      class: "btn btn-sm danger-text",
      type: "button",
      onclick: async () => {
        dialog.close();
        if (!(await confirmBox(`關閉「${acc.name}」？`, "從今天起它的餘額算 0，過去的總覽不受影響。", "關閉帳戶"))) return;
        try {
          await api.closeFinanceAccount(acc.id, localDate());
          toast("已關閉");
          await reload();
        } catch (err) {
          toast(err.message, true);
        }
      },
    },
    "關閉這個帳戶"
  );
  const dialog = modal({
    title: "編輯帳戶",
    fields: [
      name.node,
      institution.node,
      el("p", { class: "field-hint" }, `幣別：${acc.currency}（不能改）`),
      close,
    ],
    confirmLabel: "儲存",
    onConfirm: async () => {
      const value = name.input.value.trim();
      if (!value) throw new Error("請輸入帳戶名稱");
      await api.updateFinanceAccount(acc.id, {
        name: value,
        institution: institution.input.value.trim() || null,
      });
      toast("已更新");
      await reload();
    },
  });
}

/* --- 盤點 ------------------------------------------------------------- */

/**
 * 一次盤點所有帳戶。預填上次的數字，只改有變的格子。
 *
 * 清空的格子不送出——它會沿用上次的數字；要歸零請填 0。
 * 「沒記」與 0 是兩回事，跟評分留空不等於 0 分同一條規則。
 */
async function openSnapshot(reload, onlyAccountId = null) {
  const today = localDate();
  const [current, live] = await Promise.all([
    api.financeOverview(today),
    api.liveRates().catch((err) => ({ rates: {}, error: err.message })),
  ]);
  const base = current.base_currency;
  const active = current.accounts.filter((a) => a.is_active && (!onlyAccountId || a.id === onlyAccountId));
  const single = onlyAccountId ? active[0] : null;
  const foreign = [...new Set(active.map((a) => a.currency))].filter((c) => c !== base);

  const date = el("input", { type: "date", value: today });
  const dateField = el(
    "div",
    { class: "field" },
    el("label", {}, "這些數字是哪一天的"),
    date,
    el("span", { class: "field-hint" }, "對帳單是月底的，就改成月底那天")
  );

  const rateInputs = foreign.map((cur) => {
    const fetched = live.rates?.[cur]?.rate;
    const stored = current.rates[cur]?.rate;
    const input = el("input", {
      type: "text",
      inputmode: "decimal",
      value: fetched || stored || "",
    });
    const hint = fetched
      ? `自動抓到 ${live.rates[cur].as_of} 的中間價，可直接改成銀行牌告價`
      : stored
        ? `抓不到，先帶入上次的 ${stored}`
        : "抓不到，請直接填";
    return {
      cur,
      fetched,
      input,
      node: el(
        "div",
        { class: "field fin-rate-field" },
        el("label", {}, `1 ${cur} = ? ${base}`),
        input,
        el("span", { class: "field-hint" }, hint)
      ),
    };
  });

  const cells = [];
  const blocks = active.map((acc) =>
    el(
      "fieldset",
      { class: "fin-block" },
      el("legend", {}, `${acc.name}`, el("span", { class: "fin-acc-meta" }, ` ${acc.currency}`)),
      el(
        "div",
        { class: "fin-block-grid" },
        ...current.classes.map((cls) => {
          const prev = acc.cells[cls.id];
          const input = el("input", {
            type: "text",
            inputmode: "decimal",
            value: prev ? plain(prev.amount_minor) : "",
            placeholder: "—",
          });
          cells.push({ acc, cls, input });
          return el(
            "label",
            { class: `fin-cell ${cls.is_liability ? "fin-neg" : ""}` },
            el("span", {}, cls.name),
            input
          );
        })
      )
    )
  );

  const fresh = single && !Object.keys(single.cells).length;
  modal({
    title: single ? `${single.name}：${fresh ? "填入餘額" : "改餘額"}` : "更新所有餘額",
    wide: true,
    fields: [
      el("h4", { class: "fin-sub" }, single ? "裡面現在有多少錢" : "各帳戶現在有多少錢"),
      el(
        "p",
        { class: "field-hint" },
        fresh
          ? "有的才填，沒有的留空。活存、存款填在「現金」；信用卡這期要繳的金額填在「信用卡未繳」（填正數，會自動扣掉）。"
          : "已帶入上次的數字，只改有變的。負債（信用卡、貸款）填正數。清空的格子沿用上次；要歸零請填 0。"
      ),
      ...blocks,
      ...(foreign.length
        ? [
            el("h4", { class: "fin-sub" }, "匯率"),
            live.error ? el("p", { class: "fin-warn" }, live.error) : null,
            ...rateInputs.map((r) => r.node),
          ]
        : []),
      dateField,
    ].filter(Boolean),
    confirmLabel: "存檔",
    onConfirm: async () => {
      const asOf = date.value || today;
      const payloadCells = cells
        .filter((c) => c.input.value.trim() !== "")
        .map((c) => ({
          account_id: c.acc.id,
          class_id: c.cls.id,
          amount: c.input.value.trim(),
        }));
      const rates = rateInputs
        .filter((r) => r.input.value.trim() !== "")
        .map((r) => ({
          currency: r.cur,
          rate: r.input.value.trim(),
          source: r.fetched && r.input.value.trim() === r.fetched ? "auto" : "manual",
        }));
      if (!payloadCells.length && !rates.length) throw new Error("沒有任何數字可以存");
      await api.saveFinanceSnapshot({ as_of: asOf, cells: payloadCells, rates });
      // 「截至今天」一定包含剛存的這批，不論它被標成哪一天
      view.on = today;
      toast("已存檔");
      await reload();
    },
  });
}
