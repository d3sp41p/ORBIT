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

1. railway.com → **New Project → Deploy from GitHub repo** → тот же репозиторий.
2. В настройках сервиса:
   - **Root Directory:** оставить пустым (корень репозитория — нужен для монорепо).
   - Config подхватывается сам из `railway.json` в корне репозитория (если в **Config-as-code** что-то вписано — очистить).
     Там указаны `apps/worker/Dockerfile`, healthcheck `/health` и перезапуск при падении.
3. **Settings → Networking → Generate Domain** (порт 8080), чтобы открыть `/health` снаружи.
4. Проверка: в логах `[worker] started on :8080`, раз в минуту `[worker] alive ...`; `https://<домен>/health` отдаёт `{"status":"ok",...}`.

## 4. Остальные аккаунты (понадобятся с этапа 4)

Supabase, Helius, Anthropic. Ключи — только в настройках Vercel/Railway и в локальном `.env.local`, никогда в чат и в код.
