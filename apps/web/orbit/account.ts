/**
 * The visitor's account in the header: "Connect wallet", then "My planet"
 * and a menu with "Log out" (and "Moderation" for admins). Also the wallet
 * picker dialog and short notices (toasts). Used by the system view and by
 * the admin page.
 */
import { esc, shortAddr } from "@orbit/core";
import type { Wallet } from "@wallet-standard/base";
import { copy as t } from "./copy";
import {
  NOBODY,
  onWalletsChange,
  openInWallet,
  signIn,
  signOut,
  solanaWallets,
  whoAmI,
  type Me,
} from "./wallet";

export interface Account {
  readonly me: Me;
  onChange(cb: (me: Me) => void): void;
  /** Open the wallet picker. */
  open(): void;
  toast(message: string): void;
}

const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export function mountAccount(root: HTMLElement, opts: { onMyPlanet?: () => void } = {}): Account {
  let me: Me = NOBODY;
  let used: Wallet | null = null;
  let busy = false;
  let status = "";
  const listeners: ((m: Me) => void)[] = [];

  /* ---------- toast ---------- */
  const toastEl = document.createElement("div");
  toastEl.className = "toast";
  toastEl.setAttribute("role", "status");
  toastEl.hidden = true;
  document.body.appendChild(toastEl);
  let toastTimer = 0;
  function toast(message: string) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastEl.hidden = true), 4500);
  }

  /* ---------- wallet picker ---------- */
  const dlg = document.createElement("div");
  dlg.className = "wdlg";
  dlg.hidden = true;
  dlg.setAttribute("role", "dialog");
  dlg.setAttribute("aria-modal", "true");
  dlg.setAttribute("aria-labelledby", "wdlgH");
  document.body.appendChild(dlg);

  function renderDialog() {
    const wallets = solanaWallets();
    const here = location.href;
    const list = wallets.length
      ? `<ul class="wlist">${wallets
          .map(
            (w, i) =>
              `<li><button class="btn" data-w="${i}" ${busy ? "disabled" : ""}><img src="${esc(w.icon)}" alt="" width="22" height="22">${esc(w.name)}</button></li>`,
          )
          .join("")}</ul>`
      : `<p class="note">${t.noWallets}</p><div class="row">${
          isPhone()
            ? `<a class="btn" href="${esc(openInWallet.phantom(here))}">${t.openPhantom}</a><a class="btn" href="${esc(openInWallet.solflare(here))}">${t.openSolflare}</a>`
            : `<a class="btn" href="https://phantom.com/download" target="_blank" rel="noopener noreferrer">${t.installPhantom}</a><a class="btn" href="https://solflare.com/download" target="_blank" rel="noopener noreferrer">${t.installSolflare}</a>`
        }</div>`;
    dlg.innerHTML = `<div class="wbox"><h3 id="wdlgH">${t.walletH}</h3><p class="note">${t.walletNote}</p>${list}${
      status ? `<p class="wstatus" role="status">${esc(status)}</p>` : ""
    }<div class="row"><button class="btn ghost" id="wClose">${t.close}</button></div></div>`;
    dlg
      .querySelectorAll<HTMLButtonElement>("[data-w]")
      .forEach((b) => (b.onclick = () => void choose(wallets[+b.dataset.w!]!)));
    (dlg.querySelector("#wClose") as HTMLButtonElement).onclick = close;
  }

  async function choose(w: Wallet) {
    busy = true;
    status = t.signing;
    renderDialog();
    try {
      const m = await signIn(w);
      used = w;
      set(m);
      close();
      if (m.wallet) toast(t.signedIn(shortAddr(m.wallet)));
    } catch (e) {
      status = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      if (!dlg.hidden) renderDialog();
    }
  }

  function open() {
    status = "";
    dlg.hidden = false;
    renderDialog();
    (dlg.querySelector("button") as HTMLButtonElement | null)?.focus();
  }
  function close() {
    dlg.hidden = true;
  }
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg && !busy) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !dlg.hidden && !busy) {
      e.stopPropagation();
      close();
    }
  });
  onWalletsChange(() => {
    if (!dlg.hidden) renderDialog();
  });

  /* ---------- header ---------- */
  function renderHeader() {
    if (!me.wallet) {
      root.innerHTML = `<button class="btn" id="connectBtn">${t.connect}</button>`;
      (root.querySelector("#connectBtn") as HTMLButtonElement).onclick = open;
      return;
    }
    root.innerHTML = `${opts.onMyPlanet ? `<button class="btn" id="myPlanetBtn">${t.myPlanet}</button>` : ""}<span class="acct-wrap"><button class="btn acct-btn" id="acctBtn" aria-haspopup="true" aria-expanded="false"><span class="live"></span>${esc(shortAddr(me.wallet))}</button><span class="acct-menu" hidden>${
      me.admin ? `<a href="/admin">${t.moderation}</a>` : ""
    }<button id="logoutBtn">${t.logout}</button></span></span>`;
    const btn = root.querySelector("#acctBtn") as HTMLButtonElement;
    const menu = root.querySelector(".acct-menu") as HTMLElement;
    btn.onclick = (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      btn.setAttribute("aria-expanded", String(!menu.hidden));
    };
    (root.querySelector("#logoutBtn") as HTMLButtonElement).onclick = async () => {
      await signOut(used);
      used = null;
      set(NOBODY);
    };
    const mine = root.querySelector("#myPlanetBtn") as HTMLButtonElement | null;
    if (mine) mine.onclick = () => opts.onMyPlanet?.();
  }

  function set(m: Me) {
    me = m;
    renderHeader();
    listeners.forEach((cb) => cb(me));
  }

  // A click anywhere else closes the account menu.
  document.addEventListener("click", () => {
    const menu = root.querySelector<HTMLElement>(".acct-menu");
    if (menu && !menu.hidden) {
      menu.hidden = true;
      root.querySelector("#acctBtn")?.setAttribute("aria-expanded", "false");
    }
  });

  renderHeader();
  void whoAmI().then((m) => {
    if (m.wallet !== me.wallet) set(m);
  });

  return {
    get me() {
      return me;
    },
    onChange: (cb) => void listeners.push(cb),
    open,
    toast,
  };
}
