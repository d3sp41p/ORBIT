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

## 5. Переменные окружения

Значения копировать из локального `.env.local`. Ключи никогда не отправлять в чат.
Адрес монеты, тикер и ссылки в переменные **не** пишутся: они задаются в базе
командами запуска (раздел 6), сайт и воркер подхватывают их на лету.

**Vercel** (Project → Settings → Environment Variables, окружение Production):

| Переменная | Значение |
| --- | --- |
| `SUPABASE_URL` | из `.env.local` |
| `SUPABASE_ANON_KEY` | из `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | из `.env.local` |
| `HELIUS_WEBHOOK_SECRET` | из `.env.local` |
| `MIN_HOLDING_TOKENS` | `100000` |
| `ADMIN_WALLETS` | адреса кошельков модераторов через запятую (видят жалобы и скрывают названия на `/admin`) |

`SUPABASE_SERVICE_ROLE_KEY` нужен сайту для входа через кошелёк, настроек планеты и жалоб: он
используется только на сервере и не попадает в браузер (проверено поиском по клиентским файлам сборки).

После сохранения: Deployments → последний деплой → ⋮ → **Redeploy**.

**Railway** (сервис воркера → Variables → Raw Editor):

```
HELIUS_API_KEY=...
SUPABASE_DB_URL=...
HELIUS_WEBHOOK_SECRET=...
WEBHOOK_URL=https://orbit-green-chi.vercel.app/api/webhooks/helius
MIN_HOLDING_TOKENS=100000
SNAPSHOT_INTERVAL_SEC=60
BACKFILL_LIMIT=20000
ANTHROPIC_API_KEY=...
AI_DAILY_BUDGET_USD=2.5
```

Без `ANTHROPIC_API_KEY` (или при `AI_DAILY_BUDGET_USD=0`) все тексты остаются шаблонными — сайт работает
как обычно. Состояние ИИ видно в health воркера (поле `ai`: включён, расход за сегодня, очередь) и
в строке `[worker] alive` в логах раз в 10 минут.

`TOKEN_MINT` на Railway не нужен: до запуска воркер ничего не индексирует и не тратит
кредиты Helius, а после — берёт монету из базы. Стенд (`TOKEN_MINT`) используется только
локально при разработке.

Проверка: `https://orbit-green-chi.vercel.app/api/health` показывает `"db":"ok"`;
в логах Railway — `[worker] started`.

## 6. Запуск монеты

**Автоматически (рекомендуется).** Заранее, до создания монеты:

```
pnpm launch:arm <dev-кошелёк> <ТИКЕР> "<Название>" [ссылка на X]
```

Воркер ставит вебхук Helius на dev-кошелёк. Когда с него создаётся монета на pump.fun с
тем же тикером и названием, система сама: прописывает адрес, очищает данные стенда,
переводит вебхук на монету, скрывает dev-кошелёк, ставит ссылку Buy на pump.fun и
загружает историю с первого блока. Сайт показывает адрес монеты в течение ~15 секунд,
без пересборки.

**Вручную (запасной путь):** `pnpm launch <адрес монеты> [ссылка на X]`.

Состояние: `pnpm launch:status`. Отмена ожидания: `pnpm launch:disarm`.
Вернуться к стенду (только для разработки): `pnpm launch:reset`.
