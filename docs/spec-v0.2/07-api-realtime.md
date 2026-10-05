# 07 — API & Realtime Game Flow v0.2

> Источник: API & Realtime Game Flow v0.1. Применены D-01, D-08, D-09, D-10, D-11, D-12, D-13, T-03, T-04, T-05, T-08, T-09.

## 1. Clients

| Клиент | Что делает |
|---|---|
| **Shared Display** | Waiting room, вопрос, media, таймер, reveal, distribution, end-game. Read-only. |
| **Player Client** | Join, private onboarding, ответ, confirmation, личный результат, feedback. |
| **Host Controls** | Тот же Player Client с дополнительными правами: Start, Pause, Resume, Skip, End, Play Again. |

```
Player Phones ─┐
Shared Display ┼── Realtime Gateway ── Game Service ──┬── Room Service
Host Client ───┘                                      ├── Composition Engine
                                                      ├── Scoring Service
                                                      └── PostgreSQL ── Question Bank / Media / Analytics
```

## 2. Principles

- **Backend owns state.** Клиенты рендерят; телефон не решает «время вышло» — backend публикует `ANSWER_PHASE_ENDED`.
- **REST** — команды и загрузка состояния: create, join, onboarding, start / pause / resume / skip / end, answer, feedback, state recovery.
- **Realtime** (WebSocket или аналог) — рассылка изменений.
- **Events — прошедшее время** (`QUESTION_REVEALED`, а не `REVEAL_QUESTION`); команда — это API request.
- **Reconnect всегда восстанавливается из server state**, а не из пропущенных событий.

## 3. Channels & Tokens

| Channel | Подписчики | Содержимое |
|---|---|---|
| `room:{room_id}` | display, все игроки | Групповые события |
| `player:{player_id}` | один игрок | Приватные события |

| Token | Права |
|---|---|
| Display token | Read-only `room:` |
| Player token | Своя identity, свои ответы, свой feedback |
| Host token | Player token + Start / Pause / Resume / Skip / End / Play Again |

Токены хранятся как hash. Rate limiting на join и reconnect `[T-08]`.

**Privacy boundary.** В `room:` никогда не уходят: age band, topics, cultural contexts, Dignity, affinity, hero target конкретного игрока. Если поле не нужно display — его не отправляют вообще.

## 4. Room & Join

### Create Room `[D-08]`

```
POST /rooms
→ {
  "roomId": "uuid",
  "roomCode": "F7KD3M",
  "gameSessionId": "uuid",
  "displayToken": "...",
  "hostToken": "...",
  "hostPlayerId": "uuid",
  "joinUrl": "https://.../j/F7KD3M",
  "status": "WAITING"
}
```

Backend создаёт Room (язык `ru`), первую Game Session (`ONBOARDING`), anonymous host player, room code, display token.

Display открывает `/play/F7KD3M/display` и подписывается на `room:{room_id}`.

### Join

```
POST /rooms/{roomCode}/players   { "nickname": "Юля" }
→ { "playerId", "playerToken", "gameSessionId", "roomStatus", "playerStatus": "ACTIVE" | "PENDING" }
```

Событие `PLAYER_JOINED { playerId, nickname, playerCount }`. Preferences не передаются.

## 5. Onboarding

```
GET /games/{gameSessionId}/onboarding-config
→ age bands, topic cards (2 уровня), cultural context cards, dignity options (3)
```

> Реализация M3: конфигурация встроена в клиент из `packages/shared` (генерируется из `content/taxonomy.yaml`), endpoint не нужен. Отправка — `POST /rooms/{code}/onboarding` с токеном игрока; повторная отправка между играми заменяет ответы.

```
POST /games/{gameSessionId}/players/{playerId}/onboarding
{
  "ageBand": "35_44",
  "dignityPreference": "BALANCE",            // CLASSIC | BALANCE | POP → 4 | 3 | 2  [D-13]
  "culturalContexts": ["POST_SOVIET"],       // [] или отсутствует = шаг пропущен  [D-01]
  "topics": [
    {"topicId": "cold-war", "preference": "LIKE", "depth": "EXPERT"},
    {"topicId": "ru-pop-00s", "preference": "LIKE", "depth": "INTERESTED"},
    {"topicId": "football", "preference": "LESS_OF"}
  ]
}
```

Если `culturalContexts` пуст, backend выводит контексты из `topic.implied_context_id` (source = INFERRED, strength 0.7).

Display получает только `PLAYER_READY { playerId, readyPlayers, totalPlayers }`.

## 6. Start

```
POST /games/{gameSessionId}/start      (host)
```

Проверки: Room ACTIVE/WAITING, **≥ 2 игроков** `[D-12]`, onboarding завершён (или хост разрешил стартовать без отстающих — они становятся PENDING), банк доступен.

Далее backend: загружает onboarding → `GROUP_PROFILE_SNAPSHOT` → `minor_present` → Room Dignity (медиана) → generation mix → cultural context weights → инициализирует `composition_state` → готовит `prefetch_size` (5) кандидатов `[T-09]`. Публикует `GAME_STARTED`.

## 7. Question Cycle

```
QUEUED → PRESENTING (4–9 с) → ANSWERING (15 с) → REVEALED (8 с) → next
                 ↘ SKIPPED     ↘ SKIPPED
QUEUED → CANCELLED
```

### 7.1 Presentation

`QUESTION_PRESENTED` в `room:`:

```json
{
  "gameQuestionId": "uuid",
  "questionNumber": 8,
  "media": null,
  "question": "На каком телеканале выходила программа «Куклы»?",
  "options": [
    {"id": "a1", "key": "A", "text": "НТВ"},
    {"id": "b1", "key": "B", "text": "ОРТ"},
    {"id": "c1", "key": "C", "text": "РТР"},
    {"id": "d1", "key": "D", "text": "ТВ-6"}
  ]
}
```

`correctOptionId` **не отправляется** до reveal. Телефон показывает A/B/C/D с текстом вариантов (accessibility fallback).

Presentation phase: text — короткая анимация / чтение; image — показ изображения; audio / video (P2) — проигрывание сегмента. Таймер не идёт. Media предзагружается до `QUESTION_PRESENTED`; если не готово — вопрос заменяется до показа.

### 7.2 Answer phase `[T-03]`

`ANSWER_PHASE_STARTED`:

```json
{
  "gameQuestionId": "uuid",
  "answerTimeMs": 15000,
  "remainingMs": 15000,
  "serverNow": "2026-10-01T21:00:00.000Z",
  "endsAt": "2026-10-01T21:00:15.000Z"
}
```

Клиент считает `offset = serverNow − localNow` и рисует countdown от `remainingMs`. Решение о закрытии — только server-side.

### 7.3 Submit answer

```
POST /game-questions/{gameQuestionId}/answers   { "optionId": "a1" }
```

Backend фиксирует серверное `submitted_at`, `response_time_ms` от `answering_started_at`, correctness, score. Unique `(game_question_id, player_id)` — повторный tap не создаёт второй результат (idempotent, возвращает первый). После закрытия — `ANSWER_REJECTED { reason: QUESTION_CLOSED }`.

Приватно: `ANSWER_ACCEPTED` («Ответ принят»), без «верно / неверно».
В `room:`: `ANSWER_COUNT_UPDATED { answered, activePlayers }` — без распределения.

После каждого ответа: если `answered == activePlayers` → досрочное закрытие. Иначе по таймеру → `ANSWER_PHASE_ENDED { reason: ALL_ANSWERED | TIMER_EXPIRED }`.

### 7.4 Reveal

Backend считает correct option, distribution, correct count, scores, hero proxy events (internal).

`QUESTION_REVEALED` в `room:`:

```json
{
  "correctOptionId": "a1",
  "explanation": "«Куклы» выходили на НТВ с 1994 по 2002 год.",
  "distribution": {"A": 4, "B": 1, "C": 2, "D": 0}
}
```

Приватно `PERSONAL_RESULT { correct, baseScore, speedBonus, pointsEarned }` — без позиции.

Через 10–15 с (конфиг) backend выбирает следующий вопрос. Кнопка NEXT у хоста — опциональна.

## 8. Host Commands

Все команды идемпотентны.

| Команда | Endpoint | Поведение |
|---|---|---|
| Pause | `POST /games/{id}/pause` | GameSession → PAUSED; сохраняется `paused_remaining_ms`; progression стоп; `GAME_PAUSED`. |
| Resume | `POST /games/{id}/resume` | Новый `endsAt` = now + remaining; `GAME_RESUMED` с `serverNow` / `remainingMs`. |
| Skip `[D-10]` | `POST /game-questions/{id}/skip` | Допустим в PRESENTING и ANSWERING. Status → SKIPPED; все ответы `voided = true`; fact_id использован; family не идёт следом; skip event; `QUESTION_SKIPPED`. |
| End `[D-11]` | `POST /games/{id}/end` | В любой момент. Если текущий вопрос не REVEALED → CANCELLED, ответы voided. Затем final scores, statistics, FINISHED, `GAME_FINISHED`. |
| Play Again | `POST /rooms/{id}/games` | Новая GameSession в той же Room; used ids сохраняются. |

Почему факт остаётся used после Skip: иначе через три вопроса тот же факт в другой формулировке — ощущается как баг. **Presented = consumed.**

## 9. Late Join, Disconnect, Reconnect

**Late join (P1).** Room ACTIVE → игрок проходит fast onboarding → `PLAYER.status = PENDING` `[T-04]` → со следующего `QUESTION_PRESENTED` становится ACTIVE. Не может ответить на уже начатый вопрос. Engine обновляет generation mix, topic weights, hero need (с ограничением boost, BR-131); использованные факты не пересматриваются.

**Disconnect.** Закрытие соединения → DISCONNECTED. Через 20–30 с (конфиг) исключается из `activePlayers`. Display: «Один игрок переподключается».

**Reconnect.**

```
POST /rooms/{roomId}/reconnect    (player token)
GET  /games/{gameSessionId}/state
→ {
  "gameStatus": "ACTIVE",
  "questionState": "ANSWERING",
  "currentQuestion": {...},
  "remainingMs": 6200, "serverNow": "...",
  "playerHasAnswered": true,
  "score": 7340
}
```

Reconnect после reveal возвращает экран reveal, а не старый экран ответа.

## 10. End Game

Final results payload `[D-09, D-12]`:

```json
{
  "leaderboard": [
    {"nickname": "Аня", "score": 18342, "correct": 18, "attempted": 24},
    {"nickname": "Макс", "score": 17688, "correct": 17, "attempted": 24}
  ],
  "stats": {
    "hardestQuestionId": "...",
    "everyoneKnewQuestionId": "...",
    "mostDividedQuestionId": "...",
    "onlyOneKnewQuestionId": "...",        // без имени; отсутствует при < 4 активных игроках
    "fastestCorrect": {"nickname": "Сэм", "responseTimeMs": 1820}
  }
}
```

Display: winner + score, full leaderboard, 3–5 самых интересных stats.

Телефон после результатов → `POST_GAME_FEEDBACK`:

```
POST /games/{id}/feedback
{ "difficulty": "JUST_RIGHT", "pace": "JUST_RIGHT", "culturalBalance": "MORE_POP",
  "playAgain": "YES", "differentGroup": "YES" }

POST /game-questions/{id}/feedback   { "rating": "GREAT" | "FINE" | "BAD" }
```

Donation CTA (P2): `DONATION_CTA_SHOWN`; QR на display; ничего не нужно закрывать.

**Play Again re-onboarding:** экран «Оставить мои настройки / Изменить». Данные существуют только внутри активной Room.

**Room expiry:** 6–12 ч неактивности → reconnect невозможен, repeat protection исчезает, player-level данные удаляются, агрегаты сохраняются.

## 11. Composition Interface (internal)

```
POST /internal/games/{gameSessionId}/next-question
in:  { groupProfileId, compositionState }
out: { questionId, selectionDebug: { score, components... } }
```

`selectionDebug` не покидает backend / admin.

Dynamic selection учитывает actual accuracy, late join, topic streaks, skip, непокрытых hero-игроков и позволяет играть дольше 30 минут.

## 12. Scoring

Deterministic, server-side. Input: `is_correct, response_time_ms, answer_window_ms`.

```
used   = response_time_ms / answer_window_ms
points = !is_correct || voided ? 0
       : used ≤ 0.5  ? 3
       : used ≤ 0.75 ? 2
       :               1
```

При 15 с: до 7,5 с → 3, до 11,25 с → 2, позже → 1. Маленькие числа, которые видно и легко посчитать (плейтест 1). Раньше: 1000 + до 150 за скорость.

**Reading-speed fairness:** knowledge > reading speed — системное правило; бонус остаётся малой долей score.

## 13. State Machines `[T-05]`

**Room:** `WAITING → ACTIVE → CLOSED`; `* → EXPIRED` по неактивности.

**GameSession:** `ONBOARDING → ACTIVE ⇄ PAUSED → FINISHED`; `ONBOARDING → ABORTED`.

**GameQuestion:** см. §7.

**Player:** `PENDING → ACTIVE ⇄ DISCONNECTED`; `* → LEFT`.

## 14. Events Catalogue

| Группа | События |
|---|---|
| Room | PLAYER_JOINED, PLAYER_READY, PLAYER_LEFT, PLAYER_DISCONNECTED, PLAYER_RECONNECTED |
| Game | GAME_STARTED, GAME_PAUSED, GAME_RESUMED, GAME_FINISHED, PLAY_AGAIN_STARTED |
| Question | QUESTION_PRESENTED, ANSWER_PHASE_STARTED, ANSWER_COUNT_UPDATED, ANSWER_PHASE_ENDED, QUESTION_REVEALED, QUESTION_SKIPPED, QUESTION_CANCELLED |
| Player-private | ANSWER_ACCEPTED, ANSWER_REJECTED, PERSONAL_RESULT, RECONNECT_SUCCESS |

## 15. Race Conditions

| Ситуация | Решение |
|---|---|
| Два ответа одновременно | Атомарная обработка, unique constraint |
| Ответ на границе таймера | Решает серверный timestamp |
| Skip во время прихода ответа | Решает state вопроса (ответ после SKIPPED → rejected) |
| Reconnect после reveal | State endpoint возвращает reveal |
| End нажат дважды | Idempotent |
| Pause во время reveal | Пауза останавливает auto-advance |

**Idempotency:** create answer, start, pause, resume, skip, end, play again.

## 16. Error Behaviour

Игрок не видит технических ошибок. Player: «Связь потеряна. Переподключаемся…». Display: «Один игрок переподключается». Media failure → вопрос заменяется, сессия не ломается. Analytics обновляется асинхронно — gameplay его не ждёт.

## 17. Success Criteria

- все клиенты видят одно состояние вопроса;
- ни один клиент не решает game state;
- ответ не засчитывается дважды;
- disconnect одного телефона не ломает игру, reconnect восстанавливает состояние;
- хост может pause / skip / end;
- reveal синхронный;
- preferences не утекают в общий канал;
- Play Again сохраняет used facts;
- Room работает без аккаунтов.
