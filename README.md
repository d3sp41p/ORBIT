# ORBIT · Deep Space Network

A 3D star system for a Solana token: every holder is a planet. See `CLAUDE.md` for the rules and
`docs/SPEC.md` for the full specification.

## Layout

```
apps/web        Next.js site + API routes (Vercel)
apps/worker     indexer, simulation ticks, AI queue (Railway)
packages/core   simulation, events, templates, config, shared types
reference/      ORBIT_prototype.html (source of truth for look and behaviour)
supabase/       SQL migrations
```

## Commands

Requires Node 22.12+ and pnpm 10 (`corepack enable` or `npm i -g pnpm@10`).

```bash
pnpm install
pnpm dev              # web on :3000, worker on :8080
pnpm lint             # ESLint + Prettier
pnpm typecheck
pnpm test             # Vitest
pnpm check:cyrillic   # English-only check for apps, packages, supabase
pnpm build
pnpm check            # all of the above except build
```

Environment variables: copy `.env.example` to `.env.local`. Never commit real values.

Deployment steps: `docs/DEPLOY.md`. The root `Dockerfile` builds the worker (Railway).
