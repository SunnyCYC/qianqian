/* 畫面共用的小工具。 */

export { localDate } from "./core/dates.js";

export function toast(message, isError = false) {
  let node = document.querySelector(".toast");
  if (!node) {
    node = document.createElement("div");
    node.className = "toast";
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.classList.toggle("error", isError);
  node.classList.add("show");
  clearTimeout(node._timer);
  node._timer = setTimeout(() => node.classList.remove("show"), 2600);
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

/** 點擊外部時關閉彈出層，回傳解除註冊的函式。 */
export function onClickOutside(node, handler) {
  const listener = (e) => {
    if (!node.contains(e.target)) handler(e);
  };
  // 延後註冊，否則觸發開啟的那次點擊會立刻關掉它
  setTimeout(() => document.addEventListener("mousedown", listener), 0);
  return () => document.removeEventListener("mousedown", listener);
}

export function positionPopover(popover, anchor) {
  const rect = anchor.getBoundingClientRect();
  popover.style.visibility = "hidden";
  document.body.appendChild(popover);
  const pop = popover.getBoundingClientRect();

  let left = rect.left + window.scrollX;
  let top = rect.bottom + window.scrollY + 5;
  if (left + pop.width > window.innerWidth - 10) left = Math.max(10, window.innerWidth - pop.width - 10);
  if (rect.bottom + pop.height > window.innerHeight - 10) {
    const above = rect.top + window.scrollY - pop.height - 5;
    if (above > window.scrollY + 10) top = above;
  }
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.visibility = "visible";
}

/** 彈出選單：items 是 [label, fn, { danger }] 或 "sep"。 */
export function popupMenu(anchor, items) {
  const close = () => {
    menu.remove();
    dispose();
  };
  const menu = el(
    "div",
    { class: "popover row-menu" },
    ...items.map((it) =>
      it === "sep"
        ? el("div", { class: "menu-sep" })
        : el(
            "button",
            {
              class: it[2]?.danger ? "menu-item danger" : "menu-item",
              type: "button",
              onclick: () => {
                close();
                it[1]();
              },
            },
            it[0]
          )
    )
  );
  positionPopover(menu, anchor);
  const dispose = onClickOutside(menu, close);
}

export function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept = ".json,application/json") {
  return new Promise((resolve) => {
    const input = el("input", { type: "file", accept });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      resolve(file ? await file.text() : null);
    });
    input.click();
  });
}
