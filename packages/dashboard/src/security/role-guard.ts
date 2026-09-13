import { canWrite, type Role } from "@portaless/auth";

const INTERACTIVE_SELECTOR =
  'button, input, select, textarea, a[data-action], [role="button"], [contenteditable="true"], [data-writes]';

const GUARD_ATTR = "data-role-guard-applied";

function disableElement(el: Element): void {
  if (el.getAttribute(GUARD_ATTR) === "true") return;
  el.setAttribute(GUARD_ATTR, "true");
  el.setAttribute("aria-disabled", "true");
  el.setAttribute("tabindex", "-1");
  el.classList.add("rg-disabled");

  if (
    el instanceof HTMLButtonElement ||
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  ) {
    el.disabled = true;
  }
  if (el.hasAttribute("contenteditable")) el.setAttribute("contenteditable", "false");

  const blocker = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };
  el.addEventListener("click", blocker, { capture: true });
  el.addEventListener("submit", blocker, { capture: true });
  el.addEventListener("keydown", blocker, { capture: true });
}

function restoreElement(el: Element): void {
  if (el.getAttribute(GUARD_ATTR) !== "true") return;
  el.removeAttribute(GUARD_ATTR);
  el.removeAttribute("aria-disabled");
  el.removeAttribute("tabindex");
  el.classList.remove("rg-disabled");
  if (
    el instanceof HTMLButtonElement ||
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  ) {
    el.disabled = false;
  }
  if (el.hasAttribute("contenteditable")) el.setAttribute("contenteditable", "true");
}

export function applyRoleGuard(root: ParentNode, role: Role): void {
  const elements = root.querySelectorAll(INTERACTIVE_SELECTOR);
  if (canWrite(role)) {
    elements.forEach(restoreElement);
  } else {
    elements.forEach(disableElement);
  }
}

export function observeRoleGuard(root: HTMLElement, getRole: () => Role): MutationObserver {
  applyRoleGuard(root, getRole());
  const observer = new MutationObserver(() => applyRoleGuard(root, getRole()));
  observer.observe(root, { childList: true, subtree: true, attributes: false });
  return observer;
}

export function autoInitRoleGuard(doc: Document = document): void {
  const init = () => {
    const roots = doc.querySelectorAll<HTMLElement>("[data-portaless-dashboard-root]");
    roots.forEach((root) => {
      observeRoleGuard(root, () => (root.getAttribute("data-role") as Role) || "viewer");
    });
  };

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
