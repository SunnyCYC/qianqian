/* 共用的對話框。 */

import { el, toast } from "./util.js";

export function modal({ title, fields, confirmLabel = "確定", onConfirm, onCancel = null, wide = false, cancelLabel = "取消" }) {
  const backdrop = el("div", { class: "modal-backdrop" });
  const confirmBtn = el("button", { class: "btn btn-primary", type: "button" }, confirmLabel);
  const box = el("div", { class: wide ? "modal modal-wide" : "modal" }, el("h3", {}, title), ...fields.filter(Boolean));

  // 鍵盤監聽掛在 document 上，關掉時一定要拿掉，否則舊對話框會在下一個對話框按 Enter 時再送一次
  const onKey = (e) => {
    if (e.key === "Escape") cancel();
    if (e.key === "Enter" && e.target.tagName === "INPUT" && box.contains(e.target)) confirm();
  };
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };
  const cancel = () => {
    if (!open) return;
    close();
    onCancel?.();
  };
  let busy = false;
  const confirm = async () => {
    if (busy) return;
    busy = true;
    confirmBtn.disabled = true;
    try {
      await onConfirm();
      close();
    } catch (err) {
      toast(err.message, true);
    } finally {
      busy = false;
      confirmBtn.disabled = false;
    }
  };
  confirmBtn.addEventListener("click", confirm);

  box.append(
    el(
      "div",
      { class: "modal-actions" },
      cancelLabel ? el("button", { class: "btn", type: "button", onclick: cancel }, cancelLabel) : null,
      confirmBtn
    )
  );
  backdrop.append(box);
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) cancel();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(backdrop);
  box.querySelector("input, select")?.focus();
  return { close };
}

export function textField(label, value = "", hint = null, attrs = {}) {
  const input = el("input", { type: "text", value, ...attrs });
  const node = el(
    "div",
    { class: "field" },
    el("label", {}, label),
    input,
    hint ? el("span", { class: "field-hint" }, hint) : null
  );
  return { node, input };
}

export function selectField(label, options, value, hint = null) {
  const select = el(
    "select",
    {},
    ...options.map((o) =>
      el("option", { value: o.value, ...(String(o.value) === String(value) ? { selected: "" } : {}) }, o.label)
    )
  );
  const node = el(
    "div",
    { class: "field" },
    el("label", {}, label),
    select,
    hint ? el("span", { class: "field-hint" }, hint) : null
  );
  return { node, select };
}

/** 有確定／取消的訊息框，回傳 Promise<boolean>。比 window.confirm 能放更長的說明。 */
export function confirmBox(title, message, confirmLabel = "確定") {
  return new Promise((resolve) => {
    modal({
      title,
      fields: (Array.isArray(message) ? message : [message]).map((m) => el("p", { class: "modal-text" }, m)),
      confirmLabel,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}
