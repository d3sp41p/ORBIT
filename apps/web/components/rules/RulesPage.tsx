"use client";

import {
  BALANCE,
  CATASTROPHES,
  ERAS,
  sizeOf,
  SELL_TIERS,
  STAR_TIERS,
  type PlanetClass,
} from "@orbit/core";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { copy, rulesCopy as R } from "@/orbit/copy";
import { brand } from "@/orbit/env";
import s from "./rules.module.css";

/**
 * Plain link back to the system view. A full page load on purpose: the 3D
 * engine starts once per document.
 */
const HomeLink = (props: { className?: string; children: ReactNode; "aria-label"?: string }) => (
  // eslint-disable-next-line @next/next/no-html-link-for-pages
  <a href="/" {...props} />
);

/** Round trig results so server and browser render identical markup. */
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Short money label for thresholds: $100K, $1M, $100M. */
const usd = (n: number) => (n >= 1e6 ? `${n / 1e6}M` : `${n / 1e3}K`);

const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (f: number) => `${Math.round(f * 100)}%`;
const rgb = (c: readonly number[]) =>
  `rgb(${c.map((v) => Math.round(Math.min(1, v) * 255)).join(",")})`;

/** Adds the "in view" class when a block scrolls into view (once). */
function useReveal() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const items = el.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!("IntersectionObserver" in window)) {
      items.forEach((i) => i.classList.add(s.in!));
      return;
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add(s.in!);
            io.unobserve(e.target);
          }
        }),
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );
    items.forEach((i) => io.observe(i));
    return () => io.disconnect();
  }, []);
  return root;
}

function Rule({
  id,
  tag,
  title,
  lead,
  points,
  visual,
  badge,
}: {
  id: string;
  tag: string;
  title: string;
  lead: string;
  points?: readonly string[];
  visual?: ReactNode;
  badge?: string;
}) {
  return (
    <section className={`${s.rule} ${visual ? "" : s.textOnly}`} id={id} data-reveal>
      <div className={s.ruleText}>
        <p className={s.tag}>
          <span className={s.tagDot} />
          {tag}
          {badge ? <span className={s.badge}>{badge}</span> : null}
        </p>
        <h2>{title}</h2>
        <p className={s.lead}>{lead}</p>
        {points ? (
          <ul className={s.points}>
            {points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
      </div>
      {visual ? <div className={s.visual}>{visual}</div> : null}
    </section>
  );
}

/* ================= visuals ================= */

function HeroOrbits() {
  const orbits = [
    { r: 58, size: 9, dur: 14, color: "#e9d9b8", start: 20 },
    { r: 96, size: 6, dur: 24, color: "#7fb3e6", start: 140 },
    { r: 136, size: 4.5, dur: 36, color: "#9aa9b8", start: 250 },
    { r: 176, size: 2.6, dur: 52, color: "#8a8178", start: 320 },
  ];
  return (
    <svg className={s.heroSvg} viewBox="0 0 400 400" aria-hidden="true">
      <defs>
        <radialGradient id="rStar" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff8e8" />
          <stop offset="45%" stopColor="#ffd27a" />
          <stop offset="100%" stopColor="#ff9a3c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="200" cy="200" r="60" fill="url(#rStar)" className={s.starGlow} />
      <circle cx="200" cy="200" r="16" fill="#fff4d6" />
      {orbits.map((o, i) => (
        <g key={i}>
          <circle
            cx="200"
            cy="200"
            r={o.r}
            fill="none"
            stroke={i === 0 ? "rgba(252,61,33,.7)" : "rgba(255,255,255,.14)"}
            strokeWidth="1"
          />
          <g
            className={s.spin}
            style={{
              animationDuration: `${o.dur}s`,
              animationDelay: `${-(o.start / 360) * o.dur}s`,
            }}
          >
            <circle cx={200 + o.r} cy="200" r={o.size} fill={o.color} />
            {i === 0 ? (
              <path
                d={`M ${200 + o.r - 16} 184 h 6 M ${200 + o.r - 16} 184 v 6 M ${200 + o.r + 16} 184 h -6 M ${200 + o.r + 16} 184 v 6 M ${200 + o.r - 16} 216 h 6 M ${200 + o.r - 16} 216 v -6 M ${200 + o.r + 16} 216 h -6 M ${200 + o.r + 16} 216 v -6`}
                stroke="#fc3d21"
                strokeWidth="1.3"
                fill="none"
              />
            ) : null}
          </g>
        </g>
      ))}
    </svg>
  );
}

function HoldGauge() {
  const min = brand.minHolding;
  const r = R.rules.entry;
  return (
    <div className={s.gauge}>
      <div className={s.gaugeHead}>
        <span>{r.gaugeLabel}</span>
        <span className={s.mono}>
          {fmtInt(min)} ${brand.ticker}
        </span>
      </div>
      <div className={s.gaugeStage}>
        <div className={s.dustField} aria-hidden="true">
          {Array.from({ length: 14 }, (_, i) => (
            <i
              key={i}
              style={{
                left: `${(i * 37) % 46}%`,
                top: `${(i * 53) % 80}%`,
                animationDelay: `${i * 0.2}s`,
              }}
            />
          ))}
        </div>
        <div className={s.formingPlanet} aria-hidden="true" />
      </div>
      <div className={s.bar}>
        <div className={s.barFill} />
        <div className={s.barMark} />
      </div>
      <div className={s.gaugeScale}>
        <span>0</span>
        <span className={s.gaugeMin}>{fmtInt(min)}</span>
        <span>{fmtInt(min * 2)}</span>
      </div>
      <div className={s.gaugeLegend}>
        <span>{r.dust}</span>
        <span className={s.accent}>{r.world}</span>
      </div>
    </div>
  );
}

const CLASS_ROWS: { cls: PlanetClass; ranks: string; rank: number; fill: string }[] = [
  {
    cls: "super",
    ranks: "#1",
    rank: 1,
    fill: "radial-gradient(circle at 35% 35%, #fbefd6, #c99a63 60%, #5a3b22)",
  },
  {
    cls: "gas",
    ranks: "#2–10",
    rank: 5,
    fill: "radial-gradient(circle at 35% 35%, #f3e3c3, #b98a5e 60%, #4d3420)",
  },
  {
    cls: "ice",
    ranks: "#11–50",
    rank: 30,
    fill: "radial-gradient(circle at 35% 35%, #bfe6ff, #4f86c9 60%, #1b2f55)",
  },
  {
    cls: "rocky",
    ranks: "#51–200",
    rank: 120,
    fill: "radial-gradient(circle at 35% 35%, #a9c4d9, #4c6a54 55%, #1a2420)",
  },
  {
    cls: "asteroid",
    ranks: "#201+",
    rank: 400,
    fill: "radial-gradient(circle at 35% 35%, #b3aaa1, #6b625a 60%, #2b2622)",
  },
];

function ClassRow() {
  const max = sizeOf(1);
  return (
    <div className={s.classes}>
      {CLASS_ROWS.map((c, i) => {
        const d = Math.max(8, (sizeOf(c.rank) / max) * 86);
        return (
          <div key={c.cls} className={s.classItem} style={{ animationDelay: `${i * 0.12}s` }}>
            <div className={s.classSlot}>
              <span
                className={s.classBall}
                style={{ width: d, height: d, background: c.fill, animationDelay: `${i * 0.6}s` }}
              />
            </div>
            <b>{copy.cls[c.cls]}</b>
            <span className={s.mono}>{c.ranks}</span>
          </div>
        );
      })}
    </div>
  );
}

function OrbitTime() {
  const rows = [
    { r: 40, label: "Day 160", dur: 10, size: 5 },
    { r: 70, label: "Day 90", dur: 18, size: 4 },
    { r: 100, label: "Day 21", dur: 28, size: 3.5 },
    { r: 130, label: "Day 1", dur: 40, size: 3 },
  ];
  const o = R.rules.orbit;
  return (
    <div className={s.orbitBox}>
      <svg viewBox="0 0 300 300" className={s.orbitSvg} aria-hidden="true">
        <circle cx="150" cy="150" r="13" fill="#ffd27a" className={s.starGlow} />
        {rows.map((r, i) => (
          <g key={r.label}>
            <circle cx="150" cy="150" r={r.r} fill="none" stroke="rgba(255,255,255,.16)" />
            <g
              className={s.spin}
              style={{
                animationDuration: `${r.dur}s`,
                animationDelay: `${-((i * 80) / 360) * r.dur}s`,
              }}
            >
              <circle cx={150 + r.r} cy="150" r={r.size} fill={i === 0 ? "#fc3d21" : "#dfe6ee"} />
            </g>
            <text x={r2(150 + r.r * 0.71 + 4)} y={r2(150 - r.r * 0.71 - 4)} className={s.svgLabel}>
              {r.label}
            </text>
          </g>
        ))}
      </svg>
      <div className={s.orbitLegend}>
        <span>
          <i className={s.legendDotRed} />
          {o.legendOld}
        </span>
        <span>
          <i className={s.legendDot} />
          {o.legendNew}
        </span>
      </div>
    </div>
  );
}

function TickClock() {
  const steps = Math.round(24 / BALANCE.tickHours);
  return (
    <div className={s.clockBox}>
      <svg viewBox="0 0 160 160" className={s.clockSvg} aria-hidden="true">
        <circle cx="80" cy="80" r="64" fill="none" stroke="rgba(255,255,255,.2)" />
        {Array.from({ length: steps }, (_, i) => {
          const a = (i / steps) * Math.PI * 2 - Math.PI / 2;
          return (
            <g key={i}>
              <line
                x1={r2(80 + Math.cos(a) * 56)}
                y1={r2(80 + Math.sin(a) * 56)}
                x2={r2(80 + Math.cos(a) * 70)}
                y2={r2(80 + Math.sin(a) * 70)}
                stroke="#fff"
                strokeWidth="1.5"
              />
              <text
                x={r2(80 + Math.cos(a) * 44)}
                y={r2(80 + Math.sin(a) * 44) + 3}
                className={s.svgLabel}
                textAnchor="middle"
              >
                {String(i * BALANCE.tickHours).padStart(2, "0")}h
              </text>
            </g>
          );
        })}
        <g
          className={s.clockHand}
          style={{
            animationDuration: `${steps * 1.2}s`,
            animationTimingFunction: `steps(${steps})`,
          }}
        >
          <line x1="80" y1="80" x2="80" y2="24" stroke="#fc3d21" strokeWidth="2" />
        </g>
        <circle cx="80" cy="80" r="4" fill="#fc3d21" />
      </svg>
      <p className={s.caption}>
        {R.rules.sim.clock} = {BALANCE.tickHours}h
      </p>
    </div>
  );
}

function EraTrack() {
  return (
    <div className={s.eras}>
      <p className={s.subhead}>{R.rules.sim.erasTitle}</p>
      <ol className={s.eraList}>
        {ERAS.map((e, i) => (
          <li key={e} style={{ animationDelay: `${i * 1.1}s` }}>
            <span className={s.eraNode} style={{ animationDelay: `${i * 1.1}s` }} />
            <span className={s.eraNum}>{String(i).padStart(2, "0")}</span>
            <span>{e}</span>
          </li>
        ))}
      </ol>
      <p className={s.note}>{R.rules.sim.erasNote}</p>
    </div>
  );
}

function SellScale() {
  const r = R.rules.sell;
  const tiers = [
    { label: r.ignore(pct(BALANCE.sellIgnoreBelow)), name: "", tone: 0 },
    ...SELL_TIERS.map((max, i) => ({
      label: r.tierRange(pct(i === 0 ? BALANCE.sellIgnoreBelow : SELL_TIERS[i - 1]!), pct(max)),
      name: CATASTROPHES[i]!,
      tone: i + 1,
    })),
    { label: r.tierFull, name: CATASTROPHES[SELL_TIERS.length]!, tone: 5 },
  ];
  return (
    <div className={s.sellScale}>
      <div className={s.sellBar}>
        {tiers.map((t, i) => (
          <span key={i} className={s[`tone${t.tone}`]} style={{ animationDelay: `${i * 0.9}s` }} />
        ))}
        <i className={s.sellCursor} />
      </div>
      <ol className={s.sellList}>
        {tiers.map((t, i) => (
          <li key={i}>
            <span className={`${s.sellSwatch} ${s[`tone${t.tone}`]}`} />
            <span className={s.mono}>{t.label}</span>
            <b>{t.name || "—"}</b>
          </li>
        ))}
      </ol>
    </div>
  );
}

function DeathCycle() {
  return (
    <div className={s.deathBox} aria-hidden="true">
      <div className={s.deathPlanet} />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <i
            key={i}
            className={s.shard}
            style={
              {
                "--dx": `${r2(Math.cos(a) * 70)}px`,
                "--dy": `${r2(Math.sin(a) * 70)}px`,
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

function Ringed() {
  return (
    <svg viewBox="0 0 240 160" className={s.ringSvg} aria-hidden="true">
      <defs>
        <radialGradient id="rRing" cx="35%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#f3e3c3" />
          <stop offset="60%" stopColor="#b98a5e" />
          <stop offset="100%" stopColor="#3a2716" />
        </radialGradient>
      </defs>
      <ellipse
        cx="120"
        cy="80"
        rx="100"
        ry="24"
        fill="none"
        stroke="rgba(233,217,184,.25)"
        strokeWidth="10"
        className={s.ringDraw}
      />
      <circle cx="120" cy="80" r="40" fill="url(#rRing)" />
      <path
        d="M 20 80 A 100 24 0 0 0 220 80"
        fill="none"
        stroke="rgba(233,217,184,.55)"
        strokeWidth="6"
        className={s.ringDraw}
      />
    </svg>
  );
}

function StarTiers() {
  return (
    <div className={s.stars}>
      {STAR_TIERS.map((t, i) => (
        <div key={t.cls} className={s.starItem}>
          <span
            className={s.starBall}
            style={{
              background: `radial-gradient(circle at 50% 50%, ${rgb(t.core)} 0%, ${rgb(t.edge)} 70%, transparent 72%)`,
              boxShadow: `0 0 ${18 + i * 6}px ${rgb(t.edge)}`,
              width: 26 + i * 8,
              height: 26 + i * 8,
              animationDelay: `${i * 0.4}s`,
            }}
          />
          <b>
            {t.cls} · {t.name}
          </b>
          <span className={s.mono}>
            {t.max === Infinity
              ? `${usd(STAR_TIERS[i - 1]!.max)} ${R.rules.star.over}`
              : `${R.rules.star.under} ${usd(t.max)}`}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ================= page ================= */

export default function RulesPage() {
  const root = useReveal();
  const min = fmtInt(brand.minHolding);
  const r = R.rules;
  const chance = Math.round(BALANCE.eventChance * 100);
  const astChance = Math.round(BALANCE.eventChance * BALANCE.asteroidEventFactor * 100);
  const ignore = pct(BALANCE.sellIgnoreBelow);
  const sections: [string, string][] = Object.entries(r).map(([id, v]) => [id, v.title]);

  return (
    <div className={s.page} ref={root}>
      <div className={s.sky} aria-hidden="true" />
      <header className={s.top}>
        <HomeLink className={s.brand}>
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
            <b>{brand.name}</b>
            <small>{copy.agency}</small>
          </span>
        </HomeLink>
        <div className={s.spacer} />
        <HomeLink className={s.btn} aria-label={R.back}>
          <span aria-hidden="true">←</span> <span className={s.backText}>{R.back}</span>
        </HomeLink>
        <a
          className={`${s.btn} ${s.primary}`}
          href={brand.buyUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {copy.buy(brand.ticker)}
        </a>
      </header>

      <main className={s.main}>
        <section className={s.hero}>
          <div className={s.heroText}>
            <p className={s.eyebrow}>{R.eyebrow}</p>
            <h1>
              {R.h1[0]}
              <br />
              {R.h1[1]}
            </h1>
            <p className={s.heroLede}>{R.lede}</p>
            <nav className={s.toc} aria-label={R.toc}>
              <p className={s.subhead}>{R.toc}</p>
              <ol>
                {sections.map(([id, title], i) => (
                  <li key={id}>
                    <a href={`#${id}`}>
                      <span className={s.mono}>{String(i + 1).padStart(2, "0")}</span>
                      {title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </div>
          <HeroOrbits />
        </section>

        <Rule
          id="entry"
          tag={r.entry.tag}
          title={r.entry.title}
          lead={r.entry.lead(min, brand.ticker)}
          points={r.entry.points(min)}
          visual={<HoldGauge />}
        />
        <Rule
          id="size"
          tag={r.size.tag}
          title={r.size.title}
          lead={r.size.lead}
          points={r.size.points}
          visual={<ClassRow />}
        />
        <Rule
          id="orbit"
          tag={r.orbit.tag}
          title={r.orbit.title}
          lead={r.orbit.lead}
          points={r.orbit.points}
          visual={<OrbitTime />}
        />
        <Rule
          id="sim"
          tag={r.sim.tag}
          title={r.sim.title}
          lead={r.sim.lead(BALANCE.tickHours)}
          points={r.sim.points(chance, astChance)}
          visual={
            <div className={s.stack}>
              <TickClock />
              <EraTrack />
            </div>
          }
        />
        <Rule
          id="sell"
          tag={r.sell.tag}
          title={r.sell.title}
          lead={r.sell.lead}
          points={r.sell.points(ignore)}
          visual={<SellScale />}
        />
        <Rule
          id="death"
          tag={r.death.tag}
          title={r.death.title}
          lead={r.death.lead}
          points={r.death.points}
          visual={<DeathCycle />}
        />
        <Rule
          id="rings"
          tag={r.rings.tag}
          title={r.rings.title}
          lead={r.rings.lead(BALANCE.ringsAfterDays)}
          points={r.rings.points}
          visual={<Ringed />}
        />
        <Rule
          id="star"
          tag={r.star.tag}
          title={r.star.title}
          lead={r.star.lead}
          visual={<StarTiers />}
        />
        <Rule
          id="news"
          tag={r.news.tag}
          title={r.news.title}
          lead={r.news.lead}
          points={r.news.points}
        />
        <Rule
          id="owner"
          tag={r.owner.tag}
          title={r.owner.title}
          lead={r.owner.lead}
          points={r.owner.points}
          badge={r.owner.soon}
        />
        <Rule
          id="excluded"
          tag={r.excluded.tag}
          title={r.excluded.title}
          lead={r.excluded.lead}
          points={r.excluded.points}
        />

        <footer className={s.footer} data-reveal>
          <HomeLink className={`${s.btn} ${s.primary}`}>{R.cta}</HomeLink>
          <p>{R.disclaimer}</p>
        </footer>
      </main>
    </div>
  );
}
