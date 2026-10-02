# Quiz Product — Specification v0.2

Единая согласованная версия семи документов v0.1 с применёнными решениями из [../decisions-v0.1.md](../decisions-v0.1.md) (приняты 2026-10-01).

Оригиналы v0.1 не сохранены как файлы; v0.2 их заменяет.

## Документы

| # | Документ | Что внутри |
|---|---|---|
| 01 | [Vision](01-vision.md) | Видение, принципы, язык и культурный контекст, Dignity, Knowledge Effects |
| 02 | [Business Rules](02-business-rules.md) | BR-001…BR-134, constraints, open rules, core acceptance |
| 03 | [Requirements](03-requirements.md) | FR-001…FR-066, NFR-001…NFR-017 |
| 04 | [Backlog](04-backlog.md) | MVP scope, 36 эпиков, stories с приоритетами, waves, DoD |
| 05 | [Composition Engine](05-composition-engine.md) | Алгоритм выбора вопросов |
| 06 | [Data Model](06-data-model.md) | ERD, таблицы, формат файлов банка |
| 07 | [API & Realtime](07-api-realtime.md) | Endpoints, события, state machines, scoring |
| 08 | [Topics MVP](08-topics-mvp.md) | 35 стартовых тем, объём контента, отложенные темы |
| 09 | [System Design](09-system-design.md) | Стек, компоненты, хранение данных, content pipeline, план волны 1 |

## Конвенции

- Текст — на русском, ID / сущности / enum — на английском.
- Изменения относительно v0.1 помечены `[D-xx]` / `[T-xx]`.
- Приоритеты: **P0 = MVP**, P1 — сразу после, P2 — rich, P3 — future.

## Главные изменения относительно v0.1

| Решение | Изменение | Где |
|---|---|---|
| D-01 | Необязательный шаг «культурный бэкграунд» + вывод из тем | BR-128, FR-062, US-ONB-008, PLAYER_CULTURAL_CONTEXT, API §5 |
| D-02 | Режим = только язык комнаты; LOCAL-вопросы не переводятся | Vision §5, BR-033–037, BR-127, FR-063/064, QUESTION.culture_specificity / origin_language |
| D-03 | MVP = волна 1 + Hero, Dignity, культурный контекст | Backlog §2, приоритеты P0 |
| D-04 | EPIC 35 Content Production, ~485 вопросов на русском, AI-драфт + ручная проверка | Backlog EPIC 35, BR-130, C-009, 08-topics |
| D-05 | Жадный выбор по шагам; шаблон слотов — иллюстрация | Engine §2, §13 |
| D-06 | Фиксированный порядок уступок целей | BR-132, Engine §7 |
| D-07 | Стартовое правило room difficulty | Engine §8 |
| D-08 | Первая GameSession создаётся вместе с Room | BR-001, API §4 |
| D-09 | Only One Knew — без имени | BR-099, API §10 |
| D-10 | Skip в PRESENTING / ANSWERING, ответы аннулируются | BR-087, API §8 |
| D-11 | End в любой момент; незавершённый вопрос → CANCELLED | BR-009, API §8 |
| D-12 | Минимум 2 игрока; при < 4 нет плашек «на одного» | BR-003, BR-129 |
| D-13 | Dignity в UI — 3 варианта | BR-047 |
| D-14 | Ограничение hero boost для late joiner | BR-131, Engine §10 |
| D-15 | Pause / Resume / Skip в P0 | Backlog EPIC 18 |
| T-01…T-10 | Единый lifecycle, нумерация эпиков, таймер, статусы, поля, состояние движка, безопасность | 06, 07 |

## Ещё открыто

См. [02-business-rules.md §26](02-business-rules.md): кривая speed bonus, таймеры, автоматический fact-check, лицензирование audio / video, retention, accessibility, UI-формулировки, donation provider, название и бренд.

## Следующий шаг

Подтвердить SD-01…SD-05 в [09-system-design.md §17](09-system-design.md), затем M1 (skeleton) и C1 (content pilot) параллельно.
