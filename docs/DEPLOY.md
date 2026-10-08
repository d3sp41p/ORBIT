# Деплой (этап 1)

## 1. GitHub

1. Создать пустой репозиторий на github.com (без README и .gitignore).
2. Прислать ссылку Claude Code — он сделает `git remote add` и `git push`.
3. Вкладка **Actions** — workflow **CI** должен стать зелёным.

## 2. Vercel — сайт

1. vercel.com → **Add New → Project** → импортировать репозиторий.
2. **Root Directory:** `apps/web`. Framework определится как Next.js сам; pnpm тоже (по `pnpm-lock.yaml`).
3. Переменные окружения пока можно не задавать — пустой сайт работает без них.
4. **Deploy.** Проверка: открывается главная с надписью «Every holder is a world.», и `/api/health` отдаёт `{"status":"ok",...}`.

## 3. Railway — воркер

1. railway.com/new → **Deploy from GitHub repo** → `d3sp41p/ORBIT`.
2. Настраивать сборку не нужно: Railway сам находит `Dockerfile` в корне репозитория (это образ воркера).
   **Root Directory** и **Config-as-code** оставить пустыми (Config as Code у Railway устарел).
3. Клик по карточке сервиса → **Settings**:
   - **Deploy → Healthcheck Path:** `/health` (необязательно);
   - **Networking → Generate Domain**, порт `8080`.
4. Проверка: в логах `[worker] started on :8080`, раз в минуту `[worker] alive ...`; `https://<домен>/health` отдаёт `{"status":"ok",...}`.

## 4. Остальные аккаунты (понадобятся с этапа 4)

Supabase, Helius, Anthropic. Ключи — только в настройках Vercel/Railway и в локальном `.env.local`, никогда в чат и в код.

## 5. Переменные окружения (этап 4)

Значения копировать из локального `.env.local`. Ключи никогда не отправлять в чат.

**Vercel** (Project → Settings → Environment Variables, окружение Production):

| Переменная | Значение |
| --- | --- |
| `SUPABASE_URL` | из `.env.local` |
| `SUPABASE_ANON_KEY` | из `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | из `.env.local` |
| `HELIUS_WEBHOOK_SECRET` | из `.env.local` |
| `TOKEN_MINT` | из `.env.local` (пока адрес монеты-стенда) |
| `TOKEN_LAUNCHED` | `0` (в день запуска — `1`) |
| `MIN_HOLDING_TOKENS` | `100000` |

После сохранения: Deployments → последний деплой → ⋮ → **Redeploy**.

**Railway** (сервис воркера → Variables → Raw Editor):

```
TOKEN_MINT=...
HELIUS_API_KEY=...
SUPABASE_DB_URL=...
MIN_HOLDING_TOKENS=100000
SNAPSHOT_INTERVAL_SEC=900
BACKFILL_LIMIT=2000
```

`SNAPSHOT_INTERVAL_SEC=900` и `BACKFILL_LIMIT=2000` — экономные значения на время разработки; к запуску: `60` и `20000`.

Проверка: `https://orbit-green-chi.vercel.app/api/health` показывает `"db":"ok"`; в логах Railway — `[indexer] snapshot: ...`.
