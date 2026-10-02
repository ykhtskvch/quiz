# 09 — System Design v0.1

> Строится на [05-composition-engine.md](05-composition-engine.md), [06-data-model.md](06-data-model.md), [07-api-realtime.md](07-api-realtime.md). Цель — MVP (волна 1), который может построить и поддерживать **один разработчик** почти без затрат на инфраструктуру.

## 1. Ключевые требования к архитектуре

| Требование | Откуда | Следствие |
|---|---|---|
| Backend владеет состоянием, серверные таймеры | API §2 | Нужен процесс, который «живёт» во время игры и сам двигает фазы |
| Комнаты на 2–8 человек, изолированы друг от друга | BR-003 | Естественная единица — **одна комната = один stateful actor** |
| Нет аккаунтов, данные игроков живут часы | BR-016, Data §7 | Runtime-данные можно хранить рядом с комнатой и удалять вместе с ней |
| Банк ~500 вопросов, редактируется в git | D-04 | Контент — артефакт сборки, а не живая БД |
| Бесплатный продукт | C-008 | Инфраструктура ≈ 0 при малой нагрузке, без постоянно работающих серверов |
| Один разработчик | — | Один язык (TypeScript) от клиента до сервера, минимум сервисов |

## 2. Рекомендуемый стек

| Слой | Выбор |
|---|---|
| Язык | **TypeScript** везде |
| Frontend | **React + Vite** (SPA), одно приложение для display, player и host |
| API | **Cloudflare Workers** + роутер **Hono** |
| Runtime комнаты | **Cloudflare Durable Object** на каждую Room (WebSocket, alarms, встроенный SQLite) |
| Контент | YAML в репо → сборка → `bank.json`, раздаётся вместе с Worker |
| Аналитика | **Cloudflare D1** (SQLite) |
| Изображения | **Cloudflare R2** (или static assets, пока их мало) |
| Валидация и типы | **zod**: общие схемы событий, API и контента |
| AI-скрипты контента | Node CLI + Claude API (`claude-opus-5-5` для драфтов) |
| Тесты | Vitest (engine, scoring), `@cloudflare/vitest-pool-workers` (Durable Object), Playwright (e2e: display + 4 телефона) |
| Ошибки | Sentry (free tier) или Workers Logs |

### Почему Durable Objects

Durable Object (DO) — это объект с уникальным именем, который Cloudflare запускает в одном экземпляре. У него своё хранилище, WebSocket-подключения и таймер (alarm). Модель API §2 ложится на него напрямую:

- `RoomDO` с именем = room code — **единственный источник истины** для комнаты; гонки (API §15) решаются тем, что запросы к одному DO выполняются последовательно;
- серверные таймеры (answer phase, reveal 10–15 с, disconnect timeout, expiry) — через alarms;
- все клиенты комнаты автоматически попадают в один экземпляр, поэтому не нужны sticky sessions, Redis и pub/sub;
- WebSocket Hibernation: простаивающая комната ничего не стоит;
- состояние в SQLite объекта переживает рестарты (T-07).

### Рассмотренные альтернативы

- **Node + Socket.IO на одном VPS / Fly.io + Postgres.** Привычнее, но нужно самому решать маршрутизацию комнаты на один процесс, восстановление после рестарта и платить за постоянно работающий сервер. Хороший запасной вариант, если не понравится Cloudflare: движок и общие пакеты переносятся без изменений (§11).
- **Supabase (Postgres + Realtime).** Отлично для БД и broadcast, но нет места для авторитетного игрового цикла с таймерами: всё равно понадобился бы отдельный сервер.

## 3. Компоненты

```
┌──────────────────────── Browser ────────────────────────┐
│  apps/web (React SPA)                                    │
│   /            landing, Create                            │
│   /j/:code     player: join → onboarding → game → feedback│
│   /d/:code     shared display                             │
└───────┬───────────────────────────────┬─────────────────┘
        │ HTTPS (команды, state)        │ WebSocket (события)
┌───────▼───────────────────────────────▼─────────────────┐
│  apps/worker  (Cloudflare Worker, Hono)                  │
│   • routing: /rooms/:code/* → RoomDO(idFromName(code))   │
│   • rate limiting join / reconnect                       │
│   • static: SPA + bank.json + images                     │
└───────┬──────────────────────────────────────────────────┘
        │
┌───────▼──────────────── RoomDO (один на комнату) ────────┐
│  state machine Room / GameSession / GameQuestion / Player│
│  SQLite: players, sessions, onboarding, game_questions,  │
│          answers, composition_state                      │
│  alarms: фазы вопроса, auto-advance, disconnect, expiry  │
│  WebSockets: display / player / host, фильтрация событий │
│  ┌─────────────────────────────┐                         │
│  │ packages/engine (чистый TS) │ ← bank.json (в памяти)  │
│  └─────────────────────────────┘                         │
└───────┬──────────────────────────────────────────────────┘
        │ async (ctx.waitUntil)
┌───────▼──────────┐      ┌──────────────┐
│ D1: analytics    │      │ R2: images   │
└──────────────────┘      └──────────────┘
```

## 4. Структура репозитория

```
quiz/
├─ apps/
│  ├─ web/              React SPA (display, player, host)
│  └─ worker/           Worker + RoomDO
├─ packages/
│  ├─ shared/           zod-схемы: API, события, enum, конфиг
│  ├─ engine/           Composition Engine + scoring (без I/O)
│  └─ content-schema/   схема YAML вопроса + валидатор
├─ content/
│  ├─ taxonomy.yaml     темы и контексты (08-topics-mvp)
│  └─ families/*.yaml   один файл = одна family
├─ scripts/content/     AI-драфт, проверка, coverage, build
└─ docs/
```

npm workspaces (pnpm не установлен — достаточно npm); скрипты на TypeScript запускаются напрямую Node ≥ 23.6 без сборки. Один `npm run dev` поднимает web + worker локально (Wrangler).

## 5. Где живут данные из 06-data-model

В MVP модель 06 распределяется по трём хранилищам. Сущности и поля те же, меняется только место хранения.

| Сущности | MVP-хранилище | Время жизни |
|---|---|---|
| ROOM, PLAYER, GAME_SESSION, PLAYER_ONBOARDING, PLAYER_TOPIC_PREFERENCE, PLAYER_CULTURAL_CONTEXT, GAME_QUESTION, PLAYER_ANSWER, composition_state | SQLite внутри **RoomDO** | До expiry комнаты (6–12 ч), затем `deleteAll()` |
| TOPIC, CULTURAL_CONTEXT, QUESTION_FAMILY, FACT, FACT_SOURCE, QUESTION, QUESTION_OPTION, связи, MEDIA_ASSET, MEDIA_RIGHTS | **YAML в git → bank.json** | Версионируется в git |
| QUESTION_STATS, ANSWER_OPTION_STATS, SESSION_FEEDBACK, QUESTION_FEEDBACK (обезличенные), SESSION_EVENT (агрегаты), GROUP_PROFILE_SNAPSHOT | **D1** | Долго (retention — OBR-008) |
| QUESTION_REVISION, QUESTION_LIFECYCLE_EVENT | **git history** | Навсегда |

**Отклонение от 06:** Postgres в MVP не нужен. Он появится в волне 3, когда редактирование уйдёт из git в admin portal. Тогда контент переедет в Postgres (или D1) по той же схеме, а YAML станет форматом импорта/экспорта.

**Приватность «бесплатно»:** индивидуальные onboarding и ответы физически никогда не покидают RoomDO. В D1 пишутся только агрегаты без player_id. Retention обеспечивается удалением объекта.

## 6. RoomDO — внутреннее устройство

### 6.1 Обработка запросов

- HTTP-команды (API §4–§10) приходят через Worker в `RoomDO.fetch()`. DO обрабатывает их по одной, поэтому idempotency и гонки решаются проверкой текущего состояния.
- Каждое изменение состояния: запись в SQLite → broadcast событий → перепланирование alarm.

### 6.2 Таймеры

У DO один alarm, поэтому дедлайны хранятся в таблице `deadlines(kind, at, ref)`, а alarm ставится на ближайший:

| kind | Что происходит |
|---|---|
| `ANSWER_PHASE_END` | Закрыть answer phase → reveal |
| `PRESENTATION_END` | PRESENTING → ANSWERING |
| `REVEAL_END` | Выбрать и показать следующий вопрос |
| `DISCONNECT_TIMEOUT` | Исключить игрока из activePlayers |
| `SOFT_END_PROMPT` | ~30 мин: предложить закончить |
| `ROOM_EXPIRY` | Агрегировать → удалить всё |

Pause удаляет дедлайны фаз и сохраняет `paused_remaining_ms`; Resume создаёт их заново.

### 6.3 WebSocket и события

- Одно соединение на клиента: `GET /rooms/:code/ws?token=…`. Тип клиента (display / player / host) определяется по токену.
- Сообщение: `{ "seq": 42, "type": "QUESTION_REVEALED", "payload": {...} }`.
- **`seq`** растёт монотонно в пределах комнаты. Если клиент видит пропуск, он вызывает `GET /games/:id/state` (API §9) — так выполняется правило «восстановление из server state».
- Фильтрация: событие собирается отдельно для каждой аудитории (display / все игроки / один игрок). Приватные поля (API §3, privacy boundary) не попадают в сборщики для `room:`.
- Используется WebSocket Hibernation API: пока комната ждёт, объект выгружается из памяти.

### 6.4 Привязка к комнате

- Room code: 6 символов из алфавита без 0/O/1/I (31⁶ ≈ 887 млн).
- Create: Worker генерирует код → `RoomDO(idFromName(code)).init()`. Если объект уже инициализирован, генерирует новый код.
- Токены: 128 бит случайности, в DO хранится только SHA-256.

## 7. Composition Engine как пакет

`packages/engine` — чистые функции без сети и БД:

```ts
nextQuestion(input: {
  bank: Bank;                 // из bank.json
  profile: GroupProfile;      // агрегат + индивидуальные affinity
  state: CompositionState;    // used ids, recent, hero_need…
  config: EngineConfig;       // веса, окна, коэффициенты (NFR-015)
  rng: () => number;          // seeded — для тестов и воспроизводимости
}): { questionId: string; debug: SelectionDebug; nextState: CompositionState }

score(answer, window, config): { base, bonus, total }
aggregateProfile(onboardings, taxonomy, config): GroupProfile
```

Это даёт:

- **тестируемость:** fixture-комнаты («5 × 35–44 + подросток», «все POST_SOVIET», «пустая ниша») проверяются unit-тестами на guardrails (Engine §17) и покрытие Hero;
- **симулятор:** CLI прогоняет 1000 виртуальных игр по банку и печатает метрики Engine §16 — так находятся дыры в контенте до плейтеста;
- **переносимость:** если уйти с Cloudflare, движок не меняется.

Банк (~500 вопросов, < 1 МБ) загружается в память DO один раз; индексы по теме, контексту и языку строятся при загрузке.

## 8. Content Pipeline (EPIC 35)

```
taxonomy.yaml + план покрытия (08-topics)
        │
        ▼
[1] draft    scripts/content/draft.ts   --topic ru-pop-00s --n 20 --mix "3e,6m,4h,2s"
        │    Claude API → families/*.yaml, status: DRAFT, generation_method: AI
        ▼
[2] critique scripts/content/critique.ts
        │    второй проход модели: неоднозначность, слабые distractors,
        │    шутливый тон, переводимость, возрастная безопасность → поле review_notes
        ▼
[3] human    ручная проверка в редакторе: факт, источник (открыть ссылку!),
        │    правка текста → status: FACT_CHECKED → APPROVED
        ▼
[4] validate scripts/content/validate.ts  (в CI, блокирует merge)
        │    схема zod; ровно 1 correct из 4; ≥ 1 source; уникальные ids;
        │    LOCAL ⇒ language = origin_language и нет переводов fact_id (BR-127);
        │    image ⇒ rights VERIFIED; explicit ⇒ age_safety
        ▼
[5] build    scripts/content/build.ts → bank.json (только APPROVED / GOLD)
        │    + coverage.md: тема × difficulty × dignity × generation (US-CONT-005)
        ▼
[6] dedup    scripts/content/dedup.ts — поиск похожих формулировок между families
```

Правила:

- **Источники от модели не считаются проверенными.** Модель может выдумать URL; шаг 3 обязателен (BR-130).
- Гайдлайн (US-CONT-002) лежит в репо и передаётся в промпт драфта: тон, типы distractors, шкала Dignity с примерами, непереводимость, правила для 13–17.
- Калибровка затрат: сначала пилот на 50 вопросов (1–2 темы), замерить время ручной проверки и стоимость API, потом масштабировать.
- Обновление контента = commit → CI → deploy. Активные комнаты доигрывают на старом банке.

## 9. Frontend

- Одно SPA, три режима по маршруту. Display — крупная типографика, без зависимостей от hover, рассчитан на браузер ноутбука, подключённого к ТВ, и Smart-TV-браузеры.
- Player — mobile-first, большие кнопки A/B/C/D (NFR-007), текст вариантов на телефоне.
- **Screen Wake Lock API** на телефоне во время игры, чтобы экран не гас между вопросами.
- **Автопереподключение WebSocket** с тем же токеном (backoff 0.5 → 5 с) + запрос state. Телефоны гасят экран и закрывают сокет постоянно, поэтому базовый reconnect нужен уже в MVP. По сути это то же, что restore после refresh (US-PLAYER-002, P0). Полный сценарий с другим устройством и PENDING остаётся P1.
- Таймер рисуется по `serverNow` + `remainingMs` (NFR-017).
- Все строки через i18n-словарь с первого дня (сейчас только `ru`) — облегчит EPIC 36.
- QR генерируется на клиенте (`qrcode`).

## 10. Безопасность и приватность

| Риск | Мера |
|---|---|
| Перебор кодов | Rate limiting в Worker (binding Rate Limiting или счётчик по IP), 6-символьный код, expiry |
| Подделка команд хоста | Host token отдельно от player token, проверка в DO |
| Утечка preferences | Сборщики событий для `room:` не имеют доступа к onboarding; e2e-тест проверяет, что payload display не содержит приватных полей |
| Подсмотреть правильный ответ | `correctOptionId` не отправляется до reveal; проверка в тесте |
| Хранение данных | Runtime-данные удаляются вместе с DO; в D1 нет player_id и nickname |
| Секреты | Ключ Claude API только локально / в CI-secrets, не в Worker |

## 11. Тестирование

| Уровень | Что | Инструмент |
|---|---|---|
| Unit | Engine, scoring, агрегация профиля, валидатор контента | Vitest |
| Simulation | 1000 виртуальных игр по банку → метрики покрытия | CLI на engine |
| Integration | RoomDO: state machine, alarms, гонки, idempotency, pause / skip / end | vitest-pool-workers |
| E2E | Display + 4 player-контекста проходят полную игру; проверка privacy-payload | Playwright |
| Playtest | Живые компании, Play Again Intent | — |

## 12. Окружения и деплой

- `local` — Wrangler dev (DO, D1 и R2 эмулируются).
- `staging` и `production` — отдельные Workers, D1 и R2.
- CI (GitHub Actions): lint → typecheck → unit → content validate → build bank → integration → deploy (staging на каждый merge, production по тегу).
- Конфигурация движка (веса, таймеры) — `config/*.json` в репо, деплоится вместе с кодом (NFR-015).

## 13. Наблюдаемость и аналитика

- Ошибки клиента и Worker — Sentry; game-flow events — Workers Logs.
- В D1 при reveal пишутся: `question_stats` (+1 play, correct, distribution), skip; при окончании игры — агрегированный feedback, Play Again Intent, длительность, hero proxy (обезличенно).
- Первые отчёты — SQL-запросы к D1 из скрипта; дашборд не нужен до волны 3.

## 14. Затраты (порядок величин)

- Cloudflare: при нагрузке MVP, вероятно, бесплатный тариф или минимальный платный (около $5/мес) — проверить актуальные лимиты Durable Objects при старте.
- Домен — около $10–15 в год.
- Claude API — разовые затраты на генерацию банка; оценить на пилоте из 50 вопросов (§8).

## 15. План реализации волны 1

| Milestone | Результат | Зависит от |
|---|---|---|
| **M1 — Skeleton** ✅ | Монорепо, Create Room, QR, join, display и телефоны в одном WebSocket, захардкоженный вопрос | — |
| **M2 — Game loop** | Фазы, серверный таймер, ответы, reveal, scoring, Pause / Skip / End, final leaderboard, reconnect по токену | M1 |
| **M3 — Onboarding** | Карточки тем, depth, age, Dignity, культурный бэкграунд, агрегат профиля | M1 |
| **M4 — Engine** | `packages/engine` по документу 05 + симулятор; подключение к RoomDO | M2, M3, C1 |
| **C1 — Content pilot** ✅ | Схема, гайдлайн, скрипты, 50 вопросов в 2 темах | параллельно с M1 |
| **C2 — Content MVP** | ≈ 285 APPROVED (15 тем A + 60 wildcard) | C1 |
| **M5 — Feedback** | Offboarding, Great / Bad, запись в D1 | M2 |
| **M6 — Playtest** | 3–5 живых игр, разбор метрик, правка весов | M4, M5, C2 |

Статус M1: первый игрок, вошедший с телефона, становится хостом; создающее устройство — общий экран (токен экрана в URL-фрагменте). Таймеры, scoring и SQLite-таблицы — M2; сейчас состояние комнаты хранится одним объектом в storage DO.

Основной риск по срокам — не код, а **C2**: ручная проверка ~285 вопросов. Её стоит начать сразу после C1.

## 16. Риски

| Риск | Митигация |
|---|---|
| Привязка к Cloudflare | Движок, схемы и контент не зависят от платформы; слой DO тонкий |
| Smart-TV-браузеры | Display без тяжёлых анимаций; основной сценарий — ноутбук + HDMI |
| Мобильные браузеры рвут сокеты | Wake Lock, авто-reconnect, `seq` + state |
| Фактические ошибки AI | Обязательная ручная проверка, источники, Bad-feedback → review |
| Мало контента под нишу | Coverage-отчёт и симулятор до плейтеста; topic ring (Engine §14) |

## 17. Решения этого документа

Все приняты 2026-10-01.

| ID | Решение |
|---|---|
| SD-01 | Платформа — Cloudflare Workers + Durable Objects + D1 + R2 |
| SD-02 | Postgres откладывается до волны 3; runtime — в DO, контент — в git |
| SD-03 | Базовый WebSocket-reconnect с тем же токеном — в MVP (P0) |
| SD-04 | Monorepo TypeScript: web / worker / engine / shared / content |
| SD-05 | AI-генерация контента — офлайн-скрипты, а не функция продукта (до волны 3) |
