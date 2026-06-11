# OneBusiness QA — Платформа оценки качества чатов

Внутренняя back-office платформа, заменяющая Google-таблицу, которую Маргарита
использует для оценки качества коммуникаций бухгалтеров с клиентами (чаты
Telegram).

Стек: **Next.js (App Router, TypeScript)** + **Supabase (Postgres)** +
**Tailwind CSS**. Один full-stack-сервис, один деплой на Render.

## Возможности (v1)

1. **Панель оценки** (`/scoring`) — поиск чата по № договора / названию, ручная
   оценка по конфигурируемым критериям, комментарий, сохранение (после
   сохранения появляется новая пустая форма), редактирование оценок.
2. **Отчёт** (`/dashboard`) — ежедневный отчёт: итоги (активных/новых чатов,
   без ответственных, оценено всего), распределение по качеству
   (Отлично/Хорошо/Плохо/Критично), «Сервис Бухгалтерии» %, разбивка по
   бухгалтерам. Фильтры по дате, бухгалтеру и клиенту.
3. **Сообщения Telegram** (`/messages`) — копируемые блоки текста (отчёт и
   оценка по чату). v1 — только копирование в буфер; отправка через бота
   добавляется позже за `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`.

Вся конфигурация оценки хранится как **данные** (`src/lib/scoring.ts`), а не
зашита в JSX — модель можно менять без переписывания UI. Поддерживаются обе
модели из таблицы: 4 взвешенных критерия (по умолчанию) и статусы по задачам.

## Локальный запуск

```bash
npm install
cp .env.example .env.local   # заполните значения (или оставьте пустыми — см. ниже)
npm run dev                  # http://localhost:3000
```

**Без Supabase**: если переменные Supabase не заданы, приложение использует
встроенный in-memory store, засеянный из `src/lib/seed-data.ts`. Удобно для
локальной разработки и CI. Данные сбрасываются при перезапуске.

Вход по умолчанию (меняется через `AUTH_USERS`): `info@onebusiness.am` /
`changeme`.

## Тесты

```bash
npm test
```

Покрывают чистую логику: расчёт оценок и маппинг в band (`scoring`), агрегацию
отчёта (`report`) и генерацию текстов сообщений (`templates`).

## Переменные окружения

См. `.env.example`. Кратко:

| Переменная | Назначение |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL проекта Supabase (публичный) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon-ключ (публичный, для клиента) |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role ключ (**только сервер**, без `NEXT_PUBLIC`) |
| `DATABASE_URL` | пулинг Postgres (порт 6543) — только для прямого SQL/Prisma |
| `AUTH_SECRET` | секрет подписи сессионных JWT (`openssl rand -base64 32`) |
| `AUTH_USERS` | список `email:password` через запятую (внутренние пользователи) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | (позже) отправка через бота |

## База данных и сидинг

1. Создайте проект Supabase.
2. Выполните `db/schema.sql` в SQL-редакторе Supabase.
3. Заполните `.env.local` значениями Supabase.
4. Засейте данные:

```bash
npm run seed
```

Скрипт `scripts/seed.ts` использует общие данные из `src/lib/seed-data.ts`
(те же, что и in-memory store), поэтому mock и реальная БД согласованы. Когда
появится экспорт из Excel, положите его в `/data` и замените сид.

## Деплой на Render

Web Service, регион **Frankfurt**, Node runtime:

- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start` (биндится на `$PORT`, который инжектит Render)
- **Health Check Path**: `/api/health`
- Задайте переменные окружения из таблицы выше в настройках сервиса.

`package.json` scripts:

```json
"build": "next build",
"start": "next start -p $PORT"
```

Файл `render.yaml` присутствует для blueprint-деплоя.

## Открытые вопросы (требуют ввода Маргариты)

Помечены в коде как `// TODO(margarita):`:

1. Какая модель оценки «боевая» — 4 взвешенных критерия или статусы задач?
   По умолчанию: 4 критерия (`ACTIVE_MODEL = "weighted"` в `scoring.ts`).
2. Как выводится «Общая оценка» (0–100) из статусов задач.
3. Полный список допустимых статусов по категориям и какие штрафуют оценку.
4. Источник данных: ручной ввод в v1; оставлен хук для импорта.
5. Точные формулировки сообщений Telegram — сейчас плейсхолдеры в
   `src/lib/templates.ts`.

## Структура

```
src/
  app/                 # маршруты App Router
    (app)/             # защищённые страницы (scoring, dashboard, messages)
    login/             # страница входа
    api/               # health, auth, evaluations, report
  components/          # клиентские компоненты UI
  lib/                 # домен: scoring, report, templates, repo, auth, supabase
db/schema.sql          # схема Postgres
scripts/seed.ts        # сидинг Supabase
tests/                 # unit-тесты (node:test)
```
