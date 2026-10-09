"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import BuyLink from "@/components/BuyLink";
import { copy as t } from "@/orbit/copy";
import type { PublicToken } from "@/lib/token";

/**
 * HUD markup for the system view. The 3D engine (orbit/app.ts) attaches to
 * these elements by id after mount, so the shell itself renders on the server.
 */
export default function OrbitShell({ token }: { token: PublicToken }) {
  // Phones: the header links live behind a "Menu" button.
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest(".top")) setMenu(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menu]);

  useEffect(() => {
    const m = location.pathname.match(/^\/planet\/([^/]+)/);
    const initialWallet = m ? decodeURIComponent(m[1]!) : null;
    const params = new URLSearchParams(location.search);
    const debug = params.has("debug");
    import("@/orbit/app").then(({ start }) =>
      start({ initialWallet, debug, overrides: params, token }),
    );
    // The engine starts once per page load; token facts come with that load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <canvas id="gl" aria-label={t.canvasLabel} />
      <canvas id="ov" />
      <div id="loading">
        <div className="ld">
          <Image
            className="ld-logo"
            src="/logo.png"
            unoptimized
            alt=""
            width={84}
            height={84}
            priority
          />
          <b>ORBIT DSN</b>
          <i />
          <span id="ldText">{t.loading}</span>
          <span className="ld-claude">{t.claude.badge}</span>
        </div>
      </div>

      <header className={`hud top${menu ? " menu-open" : ""}`}>
        {/* Plain link on purpose: the engine intercepts the click and flies back to the overview. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="brand" href="/" id="brandLink">
          <Image
            className="brand-logo"
            src="/logo.png"
            unoptimized
            alt=""
            width={40}
            height={40}
            priority
          />
          <span>
            <b id="brandName">{token.name}</b>
            <small>{t.agency}</small>
          </span>
        </a>
        <dl className="tele">
          <div>
            <dt>{t.tele.utc}</dt>
            <dd id="tUtc">--:--:--</dd>
          </div>
          <div>
            <dt>{t.tele.met}</dt>
            <dd id="tMet">T+0d</dd>
          </div>
          <div>
            <dt>{t.tele.objects}</dt>
            <dd id="sHolders">0</dd>
          </div>
          <div>
            <dt>{t.tele.star}</dt>
            <dd id="sClass">G</dd>
          </div>
          <div>
            <dt>{t.tele.mcap}</dt>
            <dd id="sMcap">$0</dd>
          </div>
        </dl>
        <div className="spacer" />
        <span className="demo">{t.demo}</span>
        <nav
          className="nav"
          id="nav"
          aria-label={t.menu}
          onClick={(e) => {
            // Leaving the page or opening a dialog closes the phone menu.
            if ((e.target as Element).closest("a, #connectBtn, #myPlanetBtn")) setMenu(false);
          }}
        >
          {/* Filled by the engine: "Connect wallet", then "My planet" and the account menu. */}
          <span className="acct" id="acct" />
          {/* Full page loads on purpose: the 3D engine starts once per document. */}
          {}
          <a className="btn" href="/rules">
            {t.rules}
          </a>
          {}
          <a className="btn" href="/faq">
            {t.faq}
          </a>
          <a className="btn" id="xLink" href={token.xUrl} target="_blank" rel="noopener noreferrer">
            X
          </a>
        </nav>
        <button
          className="btn menu-btn"
          type="button"
          aria-expanded={menu}
          aria-controls="nav"
          onClick={() => setMenu((m) => !m)}
        >
          {menu ? t.close : t.menu}
        </button>
        <BuyLink token={token} className="btn primary" id="buyLink" />
      </header>

      <section className="hud hero" id="hero">
        <p className="eyebrow">{t.program}</p>
        <h1>
          {t.h1[0]}
          <br />
          {t.h1[1]}
        </h1>
        <p className="sub">{t.heroP}</p>
        <form className="search" id="searchForm" autoComplete="off">
          <input
            id="search"
            type="text"
            placeholder={t.searchPh}
            aria-label={t.searchLabel}
            spellCheck={false}
          />
          <button className="btn" type="submit">
            {t.find}
          </button>
        </form>
        <div className="search-help" id="searchHelp" />
        {}
        <a className="rules-link" href="/rules">
          {t.rulesLink} <span aria-hidden="true">→</span>
        </a>
      </section>

      <section className="hud gfeed" aria-live="polite">
        <h3>
          <span className="live" />
          <span>{t.gfeedH}</span>
        </h3>
        <ul id="gfeed" />
      </section>

      <section className="hud key">
        <div className="legend">
          <h3>{t.legendH}</h3>
          <div className="rule">
            <b>{t.legendRule.size}</b>
            {t.legendRule.sizeText}
            <b>{t.legendRule.distance}</b>
            {t.legendRule.distanceText}
          </div>
          <table>
            <tbody>
              {t.legend.map(([name, ranks]) => (
                <tr key={ranks}>
                  <td>{name}</td>
                  <td>{ranks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="zoom">
          <button className="icon-btn qbtn" id="qBtn" type="button" aria-label={t.quality}>
            AUTO
          </button>
          <button className="icon-btn" id="zIn" type="button" aria-label={t.zoomIn}>
            +
          </button>
          <button className="icon-btn" id="zOut" type="button" aria-label={t.zoomOut}>
            −
          </button>
          <button className="icon-btn" id="zFit" type="button" aria-label={t.zoomFit}>
            ◎
          </button>
        </div>
      </section>

      <div id="tip" hidden />
      <aside id="panel" hidden aria-label={t.missionPage}>
        <div className="p-scroll" id="pBody" />
      </aside>
      <div id="fpsMeter" hidden />
    </>
  );
}
