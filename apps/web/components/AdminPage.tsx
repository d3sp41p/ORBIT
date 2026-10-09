"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicToken } from "@/lib/token";
import { copy, adminCopy as a, LOCALE } from "@/orbit/copy";

interface Item {
  wallet: string;
  stockName: string;
  custom: {
    name: string | null;
    species: string | null;
    capital: string | null;
    motto: string | null;
  } | null;
  hidden: boolean;
  reports: number;
  reasons: string[];
  lastAt: number;
}

type State =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "not-admin" }
  | { kind: "ready"; items: Item[] }
  | { kind: "error"; message: string };

/**
 * Moderation (spec: "Moderation"): open "Report name" complaints, one row per
 * planet, with its custom names. Hiding them shows the stock names everywhere.
 * The server checks the admin wallet on every request; this page only reads.
 */
export default function AdminPage({ token }: { token: PublicToken }) {
  const acct = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (me: { wallet: string | null; admin: boolean }) => {
    if (!me.wallet) return setState({ kind: "signed-out" });
    if (!me.admin) return setState({ kind: "not-admin" });
    const res = await fetch("/api/admin/reports", { credentials: "same-origin" });
    const j = (await res.json().catch(() => ({}))) as {
      items?: Item[];
      error?: { message: string };
    };
    setState(
      res.ok && j.items
        ? { kind: "ready", items: j.items }
        : { kind: "error", message: j.error?.message ?? a.loadError },
    );
  }, []);

  useEffect(() => {
    let off = false;
    void import("@/orbit/account").then(({ mountAccount }) => {
      if (off || !acct.current) return;
      const account = mountAccount(acct.current);
      account.onChange((me) => void load(me));
      // The first answer of /api/auth/me arrives through onChange; visitors stay signed out.
      void fetch("/api/auth/me", { credentials: "same-origin" })
        .then((r) => r.json())
        .then((me) => void load(me))
        .catch(() => setState({ kind: "signed-out" }));
    });
    return () => {
      off = true;
    };
  }, [load]);

  async function hide(w: string, hidden: boolean) {
    setBusy(w);
    try {
      const res = await fetch(`/api/admin/planet/${w}/hide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hidden }),
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error();
      setState((s) =>
        s.kind === "ready" ? { kind: "ready", items: s.items.filter((i) => i.wallet !== w) } : s,
      );
    } catch {
      setState({ kind: "error", message: a.actionError });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="adm">
      <header className="adm-top">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="brand" href="/">
          <Image className="brand-logo" src="/logo.png" alt="" width={40} height={40} priority />
          <span>
            <b>{token.name}</b>
            <small>{copy.agency}</small>
          </span>
        </a>
        <div className="spacer" />
        <span className="acct" ref={acct} />
      </header>
      <main className="adm-main">
        <h1>{a.title}</h1>
        <p className="adm-lede">{a.lede}</p>
        {state.kind === "loading" && <p className="adm-note">{a.loading}</p>}
        {state.kind === "signed-out" && <p className="adm-note">{a.signIn}</p>}
        {state.kind === "not-admin" && <p className="adm-note">{a.notAdmin}</p>}
        {state.kind === "error" && <p className="adm-note adm-err">{state.message}</p>}
        {state.kind === "ready" && state.items.length === 0 && (
          <p className="adm-note">{a.empty}</p>
        )}
        {state.kind === "ready" && state.items.length > 0 && (
          <ul className="adm-list">
            {state.items.map((i) => (
              <li key={i.wallet}>
                <div className="adm-head">
                  <b>{i.custom?.name || i.stockName}</b>
                  <span>{a.reports(i.reports)}</span>
                  <time>{new Date(i.lastAt).toLocaleString(LOCALE)}</time>
                </div>
                <dl className="kv">
                  <dt>{a.stock}</dt>
                  <dd>{i.stockName}</dd>
                  {(["name", "species", "capital", "motto"] as const).map((f) =>
                    i.custom?.[f] ? (
                      <div key={f} style={{ display: "contents" }}>
                        <dt>{a.fields[f]}</dt>
                        <dd>{i.custom[f]}</dd>
                      </div>
                    ) : null,
                  )}
                  <dt>{a.wallet}</dt>
                  <dd className="num">
                    <a href={`/planet/${i.wallet}`} target="_blank" rel="noopener noreferrer">
                      {i.wallet}
                    </a>
                  </dd>
                </dl>
                {i.reasons.length > 0 && (
                  <ul className="adm-reasons">
                    {i.reasons.map((r, k) => (
                      <li key={k}>{r}</li>
                    ))}
                  </ul>
                )}
                <div className="row">
                  <button
                    className="btn primary"
                    disabled={busy === i.wallet}
                    onClick={() => void hide(i.wallet, true)}
                  >
                    {a.hide}
                  </button>
                  <button
                    className="btn ghost"
                    disabled={busy === i.wallet}
                    onClick={() => void hide(i.wallet, false)}
                  >
                    {a.dismiss}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
