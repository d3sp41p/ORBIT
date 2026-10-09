"use client";

import { BALANCE } from "@orbit/core";
import Image from "next/image";
import BuyLink from "@/components/BuyLink";
import { copy, faqCopy as F } from "@/orbit/copy";
import type { PublicToken } from "@/lib/token";
import { HomeLink, useReveal } from "./RulesPage";
import s from "./rules.module.css";

/** FAQ and disclaimer (spec: "FAQ page and disclaimer"), in the rules page style. */
export default function FaqPage({ token: brand }: { token: PublicToken }) {
  const root = useReveal();
  const items = F.items({
    ticker: brand.ticker,
    min: Math.round(brand.minHolding).toLocaleString("en-US"),
    ignore: `${Math.round(BALANCE.sellIgnoreBelow * 100)}%`,
    rings: BALANCE.ringsAfterDays,
  });

  return (
    <div className={s.page} ref={root}>
      <div className={s.sky} aria-hidden="true" />
      <header className={s.top}>
        <HomeLink className={s.brand}>
          <Image
            className={s.logo}
            src="/logo.png"
            unoptimized
            alt=""
            width={40}
            height={40}
            priority
          />
          <span>
            <b>{brand.name}</b>
            <small>{copy.agency}</small>
          </span>
        </HomeLink>
        <div className={s.spacer} />
        {}
        <a className={s.btn} href="/rules">
          {copy.rules}
        </a>
        <BuyLink token={brand} className={`${s.btn} ${s.primary}`} />
      </header>

      <main className={s.main}>
        <section className={`${s.hero} ${s.heroSingle}`}>
          <div className={s.heroText}>
            <p className={s.eyebrow}>{F.eyebrow}</p>
            <h1>{F.h1}</h1>
            <p className={s.heroLede}>
              {F.lede} {}
              <a className={s.inlineLink} href="/rules">
                {F.rulesLink} →
              </a>
            </p>
          </div>
        </section>

        <section className={s.faq}>
          {items.map((it, i) => (
            <details key={it.q} className={s.qa} data-reveal open={i === 0}>
              <summary>
                <span className={s.mono}>{String(i + 1).padStart(2, "0")}</span>
                {it.q}
              </summary>
              {it.a.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </details>
          ))}
        </section>

        <section className={`${s.rule} ${s.textOnly}`} id="disclaimer" data-reveal>
          <div className={s.ruleText}>
            <p className={s.tag}>
              <span className={s.tagDot} />
              {F.disclaimerTitle}
            </p>
            <h2>{F.disclaimerTitle}</h2>
            {F.disclaimer.map((p) => (
              <p key={p} className={s.lead}>
                {p}
              </p>
            ))}
          </div>
        </section>

        <footer className={s.footer} data-reveal>
          <HomeLink className={`${s.btn} ${s.primary}`}>{F.cta}</HomeLink>
          <a
            className="claude-badge"
            href={copy.claude.url}
            target="_blank"
            rel="noopener noreferrer"
            title={copy.claude.note}
          >
            <span className="spark" aria-hidden="true" />
            {copy.claude.badge}
          </a>
        </footer>
      </main>
    </div>
  );
}
