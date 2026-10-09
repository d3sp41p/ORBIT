/**
 * Text version of the system (spec: "Accessibility"): when WebGL is not
 * available, or with ?text=1, the planets are a filterable list and each one
 * opens the same mission page as in 3D.
 */
import { esc, fmt, money, STAR_TIERS } from "@orbit/core";
import type { Account } from "./account";
import { copy as t } from "./copy";
import type { DataSource, SceneData } from "./data";
import { deadPanelHTML, planetPanelHTML } from "./panel";

const PAGE = 200;

export function startTextView(o: {
  source: DataSource;
  data: SceneData;
  ticker: string;
  account: Account;
  initialWallet?: string | null;
}) {
  const { source, account } = o;
  let data = o.data;
  document.body.classList.add("text-mode");
  document.getElementById("loading")?.classList.add("gone");

  const root = document.createElement("section");
  root.className = "tview";
  root.setAttribute("aria-label", t.textView.title);
  document.body.appendChild(root);
  const panel = document.getElementById("panel")!;
  const pBody = document.getElementById("pBody")!;

  let filter = "";
  let shown = PAGE;

  function renderList() {
    const tier = STAR_TIERS[data.star.tier] ?? STAR_TIERS[0]!;
    const q = filter.trim().toLowerCase();
    const all = [...data.planets].sort((a, b) => a.rank - b.rank);
    const hits = q
      ? all.filter((p) => p.name.toLowerCase().includes(q) || p.wallet.toLowerCase().includes(q))
      : all;
    const rows = hits
      .slice(0, shown)
      .map(
        (p) =>
          `<li><button data-w="${esc(p.wallet)}"><span class="num">#${p.rank}</span><b>${esc(p.name)}</b><span>${t.cls[p.cls]} · ${esc(p.eraLabel)}</span></button></li>`,
      )
      .join("");
    root.innerHTML = `<p class="eyebrow">${t.textView.eyebrow}</p><h2>${t.textView.title}</h2>
      <p class="note">${t.textView.note}</p>
      <dl class="kv"><dt>${t.tele.star}</dt><dd>${tier.cls} · ${tier.name}</dd><dt>${t.tele.mcap}</dt><dd class="num">${money(data.star.mcap)}</dd><dt>${t.textView.worlds}</dt><dd class="num">${fmt(data.planets.length)}</dd></dl>
      <input id="tFilter" type="search" placeholder="${esc(t.searchPh)}" aria-label="${esc(t.searchLabel)}" value="${esc(filter)}" spellcheck="false">
      <ol class="tlist">${rows || `<li><p class="empty">${t.textView.none}</p></li>`}</ol>
      ${hits.length > shown ? `<button class="btn" id="tMore">${t.textView.more(hits.length - shown)}</button>` : ""}`;
    const input = root.querySelector<HTMLInputElement>("#tFilter")!;
    input.oninput = () => {
      filter = input.value;
      shown = PAGE;
      renderList();
      const again = root.querySelector<HTMLInputElement>("#tFilter")!;
      again.focus();
      again.setSelectionRange(again.value.length, again.value.length);
    };
    root
      .querySelectorAll<HTMLButtonElement>("[data-w]")
      .forEach((b) => (b.onclick = () => void open(b.dataset.w!)));
    const more = root.querySelector<HTMLButtonElement>("#tMore");
    if (more)
      more.onclick = () => {
        shown += PAGE;
        renderList();
      };
  }

  function close() {
    panel.hidden = true;
    document.body.classList.remove("panel-open");
    history.replaceState(null, "", `/${location.search}`);
  }

  async function open(wallet: string) {
    panel.hidden = false;
    document.body.classList.add("panel-open");
    pBody.innerHTML = `<button class="back" id="pBack">← ${t.back}</button><p class="empty">${t.loading}</p>`;
    bind();
    history.replaceState(null, "", `/planet/${wallet}${location.search}`);
    const r = await source.card(wallet).catch(() => ({ status: "none" }) as const);
    if (r.status === "alive")
      pBody.innerHTML = planetPanelHTML(
        r.card,
        r.card.news,
        false,
        { ticker: o.ticker },
        { live: source.live, me: account.me.wallet, editing: false, editErr: "", reporting: false },
      );
    else if (r.status === "dead") pBody.innerHTML = deadPanelHTML(r);
    else
      pBody.innerHTML = `<button class="back" id="pBack">← ${t.back}</button><p class="empty">${t.textView.none}</p>`;
    bind();
    pBody.scrollTop = 0;
    document.getElementById("pBack")?.focus({ preventScroll: true });
  }

  function bind() {
    const back = document.getElementById("pBack");
    if (back) back.onclick = close;
  }

  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) close();
  });
  source.start({
    onNews: () => undefined,
    onNewsText: () => undefined,
    onPlanetEvent: () => undefined,
    onScene: (d) => {
      data = d;
      renderList();
    },
    onStar: (s) => {
      data = { ...data, star: { ...data.star, ...s } };
      renderList();
    },
  });
  renderList();
  if (o.initialWallet) void open(o.initialWallet);
}
