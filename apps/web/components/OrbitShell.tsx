"use client";

import { useEffect } from "react";
import { copy as t } from "@/orbit/copy";
import { brand } from "@/orbit/env";

/**
 * HUD markup for the system view. The 3D engine (orbit/app.ts) attaches to
 * these elements by id after mount, so the shell itself renders on the server.
 */
export default function OrbitShell() {
  useEffect(() => {
    const m = location.pathname.match(/^\/planet\/([^/]+)/);
    const initialWallet = m ? decodeURIComponent(m[1]!) : null;
    const debug = new URLSearchParams(location.search).has("debug");
    import("@/orbit/app").then(({ start }) => start({ initialWallet, debug }));
  }, []);

  return (
    <>
      <canvas id="gl" aria-label={t.canvasLabel} />
      <canvas id="ov" />
      <div id="loading">
        <div className="ld">
          <b>ORBIT DSN</b>
          <i />
          <span id="ldText">{t.loading}</span>
        </div>
      </div>

      <header className="hud top">
        {/* Plain link on purpose: the engine intercepts the click and flies back to the overview. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="brand" href="/" id="brandLink">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <circle cx="16" cy="16" r="14.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <ellipse
              cx="16"
              cy="16"
              rx="14"
              ry="5.2"
              transform="rotate(-24 16 16)"
              fill="none"
              stroke="#fc3d21"
              strokeWidth="1.4"
            />
            <circle cx="16" cy="16" r="3.2" fill="currentColor" />
            <circle cx="27.4" cy="11.2" r="1.7" fill="#fc3d21" />
          </svg>
          <span>
            <b id="brandName">{brand.name}</b>
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
        <a className="btn" id="xLink" href={brand.xUrl} target="_blank" rel="noopener noreferrer">
          X
        </a>
        <a
          className="btn primary"
          id="buyLink"
          href={brand.buyUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t.buy(brand.ticker)}
        </a>
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
