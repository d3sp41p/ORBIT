# ORBIT — project guide for Claude Code

ORBIT is a 3D website for a Solana memecoin. Every token holder is a planet orbiting a star that represents the coin. A planet's size comes from the holder's rank, its orbit from how long they have held, and a server-side simulation grows (or ruins) a civilization on it. Claude writes the planets' news from simulation facts. Owners can rename their planet, species, capital and motto after signing a message with their wallet.

The full specification is the document "ORBIT — ТЗ и план разработки" (Russian); a copy lives in `docs/SPEC.md`. When this file and the spec disagree, the spec wins. Ask the owner before changing any game rule.

## Reference prototype

`reference/ORBIT_prototype.html` is the source of truth for look and behaviour:

- Shaders: `PLANET_FS`, `SKY_FS`, `ATMO_FS`, `RING_FS`, `STAR_FS` — copy them unchanged.
- Simulation: `initSim`, `step`, `chooseEvent`, `applyEvent`, `applySell`, `eraOf`, `hab`, `lifeChanceDay`, `syncVisual` — port to TypeScript in `packages/core` without changing formulas.
- Sizes and classes: `classOf`, `sizeOf`; orbit radius `34 + f^0.82 * 520`; star tiers `STAR_TIERS`.
- Event texts: `EV.en`; UI copy: `I18N.en`; word lists: `W` (English values only).
- Visual style: NASA-inspired mission control (black, white hairlines, single red-orange accent `#fc3d21`, Public Sans + IBM Plex Mono, UTC / mission-time telemetry bar, leader-line planet labels, full-height "mission page" per planet, news as press releases). Match it exactly. Do not use NASA's name, logo or insignia; the brand is "ORBIT · Deep Space Network".
- The prototype generates fake holders and runs the simulation in the browser. The real product does neither: holders come from the chain and the simulation runs only on the server.

## Hard rules

1. **English only.** No Russian (or any Cyrillic) anywhere in the shipped product: UI, event texts, code comments, metadata, OG images. No language switcher. CI must fail if `grep -rP "[А-Яа-яЁё]" apps packages` finds anything.
2. **The server is the single source of truth.** The browser never computes game state; it renders what the API and Realtime send.
3. **Determinism.** Simulation RNG is seeded from `wallet + life_no` and its state is stored. Same inputs must give the same history. Never change formulas retroactively.
4. **Idempotent chain processing.** Key every chain event by transaction signature + instruction index.
5. **Secrets stay server-side.** Only `SUPABASE_ANON_KEY` may reach the browser. Never commit `.env*` files except `.env.example`.
6. **Never ask users to sign a transaction.** Wallet use is limited to `signMessage` for login.
7. **User text is data.** Escape it in HTML; pass it to Claude as quoted data, never as instructions.
8. **AI never invents numbers.** Every number in an AI text must come from the event's params; otherwise fall back to the template.
9. All balance parameters live in `packages/core/config.ts`.

## Layout

```
apps/web        Next.js (App Router) site + API routes, deployed on Vercel
apps/worker     indexer, simulation ticks, AI queue; always-on (Railway or Fly.io)
packages/core   simulation, events, templates, config, shared types
reference/      ORBIT_prototype.html
supabase/       SQL migrations
```

## Stack

TypeScript everywhere · three.js · Supabase (Postgres + Realtime, RLS on all tables) · Helius (webhooks, RPC, DAS) · Claude API with `claude-haiku-5-5` for news · Solana Wallet Adapter (Phantom, Solflare) · Sentry.

## How to work

- Work one stage at a time from the "План работ по этапам" section of the spec. For each stage: propose a short plan, implement, add tests, then list how the owner can check the acceptance criteria.
- Run `pnpm lint`, `pnpm test` and the Cyrillic check before saying a stage is done.
- Keep commits small, with messages that say what changed for the user.
- If something in the spec is ambiguous or seems wrong, stop and ask instead of guessing.
