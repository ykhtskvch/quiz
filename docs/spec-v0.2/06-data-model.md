# 06 — Data Model & ERD v0.2

> Источник: Data Model & ERD v0.1. Применены D-01, D-02, D-08, T-01, T-04, T-05, T-06, T-07, T-10.

**Ключевой принцип:** player data живёт недолго, question intelligence — долго. *The system remembers questions, not people.*

## 1. ERD

```
ROOM
 ├──< PLAYER
 └──< GAME_SESSION                      (первая создаётся вместе с Room)
        ├── GROUP_PROFILE_SNAPSHOT
        ├──< PLAYER_ONBOARDING >── PLAYER
        │      ├──< PLAYER_TOPIC_PREFERENCE >── TOPIC
        │      └──< PLAYER_CULTURAL_CONTEXT >── CULTURAL_CONTEXT     [new, D-01]
        ├──< GAME_QUESTION >── QUESTION
        │      └──< PLAYER_ANSWER
        ├──< SESSION_FEEDBACK
        ├──< QUESTION_FEEDBACK
        └──< SESSION_EVENT

QUESTION_FAMILY ──< FACT ──< FACT_SOURCE
                     └──< QUESTION
                            ├──< QUESTION_OPTION
                            ├──< QUESTION_TOPIC >── TOPIC
                            ├──< QUESTION_CONTEXT >── CULTURAL_CONTEXT
                            ├──< QUESTION_GENERATION
                            ├──< QUESTION_EFFECT >── KNOWLEDGE_EFFECT
                            ├── MEDIA_ASSET ── MEDIA_RIGHTS
                            ├── QUESTION_STATS
                            ├──< QUESTION_REVISION
                            └──< QUESTION_LIFECYCLE_EVENT
```

## 2. Game Runtime

### ROOM

```
room_id            UUID PK
room_code          VARCHAR(6) UNIQUE      -- без 0/O, 1/I  [T-08]
language           VARCHAR                -- 'ru' в MVP  [D-02]
status             ENUM  WAITING | ACTIVE | CLOSED | EXPIRED   [T-05]
created_at, closed_at, expires_at  TIMESTAMP
host_player_id     UUID nullable
display_token_hash VARCHAR
```

Room — «кто сегодня играет вместе», а не постоянная группа друзей. Expiry после 6–12 ч неактивности.

### PLAYER

```
player_id          UUID PK
room_id            UUID FK
nickname           VARCHAR
session_token_hash VARCHAR
status             ENUM  PENDING | ACTIVE | DISCONNECTED | LEFT   [T-04]
joined_at, last_seen_at, disconnected_at  TIMESTAMP
active_from_game_question_id  UUID nullable   -- для late join
is_host            BOOLEAN
```

PENDING — late joiner до следующего вопроса. «Ответил» — состояние PLAYER_ANSWER, не игрока.
**Не хранить:** email, password, real name, permanent user id, persistent interest profile.

### GAME_SESSION

```
game_session_id    UUID PK
room_id            UUID FK
sequence_no        INTEGER
status             ENUM  ONBOARDING | ACTIVE | PAUSED | FINISHED | ABORTED   [T-05]
created_at, started_at, ended_at  TIMESTAMP
target_duration_seconds       INTEGER
default_answer_timer_seconds  INTEGER
current_game_question_id      UUID nullable
minor_present                 BOOLEAN
question_audio_enabled        BOOLEAN
composition_state             JSONB          -- [T-07], см. Engine §3
paused_remaining_ms           INTEGER nullable
```

### PLAYER_ONBOARDING

Привязан к Game Session: после Play Again состав и настроение могут измениться.

```
onboarding_id      UUID PK
game_session_id    UUID FK
player_id          UUID FK
age_band           ENUM  13_17 | 18_24 | 25_34 | 35_44 | 45_54 | 55_PLUS
dignity_preference SMALLINT   -- 4 | 3 | 2  [D-13]
cultural_step_skipped BOOLEAN
completed_at       TIMESTAMP
```

### PLAYER_TOPIC_PREFERENCE

```
onboarding_id   UUID FK
topic_id        UUID FK
preference      ENUM  LIKE | LESS_OF
knowledge_depth ENUM  CASUAL | INTERESTED | EXPERT  nullable
PK (onboarding_id, topic_id)
```

### PLAYER_CULTURAL_CONTEXT  `[D-01]`

```
onboarding_id        UUID FK
cultural_context_id  UUID FK
strength             DECIMAL      -- 1.0 declared, 0.7 inferred
source               ENUM  DECLARED | INFERRED
PK (onboarding_id, cultural_context_id)
```

### GROUP_PROFILE_SNAPSHOT

```
group_profile_id   UUID PK
game_session_id    UUID FK
created_at         TIMESTAMP
topic_weights      JSONB
cultural_context_weights JSONB
generation_mix     JSONB
difficulty_target  DECIMAL
dignity_target     DECIMAL      -- медиана
minor_present      BOOLEAN
```

Агрегат без индивидуальных selections; может храниться дольше onboarding.

### GAME_QUESTION

Показ вопроса конкретной комнате в конкретной игре.

```
game_question_id   UUID PK
game_session_id    UUID FK
question_id        UUID FK
sequence_number    INTEGER
status             ENUM  QUEUED | PRESENTING | ANSWERING | REVEALED | SKIPPED | CANCELLED
selected_at, presented_at, answering_started_at, revealed_at  TIMESTAMP
answer_timer_seconds INTEGER
effective_difficulty DECIMAL
skip_reason        VARCHAR nullable
selection_debug    JSONB        -- internal, никогда не уходит игрокам
hero_candidate_player_id UUID nullable  -- удаляется/агрегируется при закрытии Room
```

SKIPPED и CANCELLED (End Game до reveal) аннулируют ответы `[D-10, D-11]`.

### PLAYER_ANSWER

```
player_answer_id   UUID PK
game_question_id   UUID FK
player_id          UUID FK
question_option_id UUID FK
submitted_at       TIMESTAMP     -- серверное время
response_time_ms   INTEGER
is_correct         BOOLEAN
base_score, speed_bonus, total_score  INTEGER
voided             BOOLEAN       -- true при SKIPPED / CANCELLED
UNIQUE (game_question_id, player_id)
```

Source of truth для score. Опциональный кэш `PLAYER_SCORE (player_id, game_session_id, score_total, correct_count, answered_count, avg_response_time)`.

### SESSION_FEEDBACK

```
session_feedback_id UUID PK
game_session_id, player_id  UUID FK
difficulty_rating   ENUM  TOO_EASY | JUST_RIGHT | TOO_HARD
pace_rating         ENUM  TOO_SLOW | JUST_RIGHT | TOO_FAST
cultural_balance_rating ENUM  MORE_CLASSIC | JUST_RIGHT | MORE_POP
play_again_intent   ENUM  YES | MAYBE | NO
different_group_intent ENUM nullable
submitted_at        TIMESTAMP
```

### QUESTION_FEEDBACK

```
question_feedback_id UUID PK
game_session_id, game_question_id, player_id  UUID FK
rating     ENUM  GREAT | FINE | BAD
created_at TIMESTAMP
```

После закрытия Room агрегируется, связь с player_id удаляется.

### SESSION_EVENT

```
session_event_id UUID PK
game_session_id  UUID FK
event_type       ENUM
game_question_id, player_id  UUID nullable
created_at       TIMESTAMP
metadata         JSONB
```

GAME_STARTED, QUESTION_PRESENTED, ALL_PLAYERS_ANSWERED, TIMER_EXPIRED, PAUSED, RESUMED, QUESTION_SKIPPED, PLAYER_JOINED, PLAYER_RECONNECTED, PLAYER_LEFT, GAME_ENDED, PLAY_AGAIN_STARTED, DONATION_CTA_SHOWN, DONATION_QR_OPENED.

Donation не связывается с Player.

## 3. Content Intelligence

### TOPIC

```
topic_id         UUID PK
parent_topic_id  UUID nullable
slug             VARCHAR UNIQUE
display_name     VARCHAR       -- локализуется
category_type    ENUM
implied_context_id UUID nullable  -- для вывода культурного контекста [D-01]
active           BOOLEAN
sort_order       INTEGER
```

### CULTURAL_CONTEXT

```
cultural_context_id UUID PK
parent_context_id   UUID nullable
code                VARCHAR UNIQUE   -- GLOBAL, POST_SOVIET, RUSSIA_1990S, UK, US, EUROPE, ...
display_name        VARCHAR
active              BOOLEAN
```

### QUESTION_FAMILY

```
question_family_id UUID PK
slug, canonical_name  VARCHAR
description           TEXT
```

Family объединяет факты об одном объекте (`gangnam-style`: release_year, artist, first_youtube_billion). Same family — разрешено, но не подряд; same fact — нет.

### FACT

```
fact_id            UUID PK
question_family_id UUID FK
canonical_statement TEXT
time_sensitive     BOOLEAN
valid_from, valid_to  DATE nullable
last_verified_at   TIMESTAMP
verification_status ENUM  UNVERIFIED | VERIFIED | DISPUTED
```

Центральная сущность дедупликации: несколько формулировок и языковых версий → один fact_id.

### FACT_SOURCE

```
fact_source_id UUID PK
fact_id        UUID FK
source_name, source_url, source_type (OFFICIAL|ACADEMIC|REFERENCE|NEWS|ARCHIVE|OTHER)
retrieved_at   TIMESTAMP
is_primary     BOOLEAN
notes          TEXT
```

### QUESTION  `[T-01, T-06, D-02]`

```
question_id           UUID PK
fact_id               UUID FK
language              VARCHAR
origin_language       VARCHAR        -- язык «родной» культуры вопроса
culture_specificity   ENUM  GLOBAL | REGIONAL | LOCAL
is_bridge             BOOLEAN
question_text         TEXT
explanation           TEXT
difficulty_global     DECIMAL        -- 1–5
cultural_dignity      SMALLINT       -- 1–5
status                ENUM  DRAFT | FACT_CHECKED | APPROVED | GOLD | RETIRED
generation_method     ENUM  HUMAN | AI | HYBRID
age_safety            ENUM  ALL | NON_EXPLICIT_ADULT | EXPLICIT_18
language_complexity   ENUM  SIMPLE | MEDIUM | COMPLEX
media_asset_id        UUID nullable
presentation_duration_ms INTEGER nullable
answer_time_override  INTEGER nullable
fallback_question_id  UUID nullable
ambiguous             BOOLEAN
quality_score         DECIMAL nullable
scope                 ENUM  GLOBAL | PRIVATE_ROOM   -- для custom questions (P3)
owner_room_id         UUID nullable
created_at, updated_at TIMESTAMP
```

**Правило непереводимости (BR-127):** если `culture_specificity = LOCAL`, то `language = origin_language`; другой QUESTION с тем же fact_id на другом языке создать нельзя (проверка в валидаторе банка).

### QUESTION_OPTION

```
question_option_id UUID PK
question_id   UUID FK
option_key    CHAR      -- A–D
option_text   TEXT
is_correct    BOOLEAN
distractor_type ENUM  PLAUSIBLE | COMMON_MISCONCEPTION | NEAR_MISS | SAME_CATEGORY | CONTEXTUAL_CONFUSION  nullable
sort_order    INTEGER
```

FUNNY_ANSWER не хранится.

### Junction tables

```
QUESTION_TOPIC       (question_id, topic_id, weight)
QUESTION_CONTEXT     (question_id, cultural_context_id, relevance)   -- «Куклы»: POST_SOVIET 1.0, RUSSIA_1990S 1.0
QUESTION_GENERATION  (question_id, era ENUM 80s|90s|00s|10s|current, relevance)
QUESTION_EFFECT      (question_id, knowledge_effect, weight)
```

KNOWLEDGE_EFFECT: I_KNOW_THIS, WHY_DO_I_REMEMBER_THIS, I_FIGURED_IT_OUT, SHARED_KNOWLEDGE, HERO_CANDIDATE, BRIDGE.

## 4. Media

### MEDIA_ASSET

```
media_asset_id   UUID PK
media_type       ENUM  IMAGE | AUDIO | VIDEO
storage_type     ENUM  HOSTED | EXTERNAL_EMBED | GENERATED
internal_url, provider, provider_asset_id, source_url
duration_ms, start_time_ms, end_time_ms  INTEGER nullable
availability_status ENUM  AVAILABLE | UNAVAILABLE | UNKNOWN
```

### MEDIA_RIGHTS

```
media_rights_id  UUID PK
media_asset_id   UUID FK
creator, licence_type
commercial_use_allowed, derivatives_allowed, attribution_required  BOOLEAN
attribution_text TEXT nullable
verification_status ENUM  VERIFIED | REVIEW_REQUIRED | REJECTED
verified_at      TIMESTAMP
```

`REVIEW_REQUIRED ≠ eligible`.

## 5. Analytics & Editorial

```
QUESTION_STATS (question_id PK, times_played, times_answered, correct_rate,
                avg_response_time_ms, skip_rate, great_rate, fine_rate, bad_rate,
                last_played_at)
ANSWER_OPTION_STATS (question_option_id PK, selected_count, selection_rate)
QUESTION_REVISION (question_revision_id, question_id, revision_number, question_text,
                   options_snapshot JSONB, explanation, metadata_snapshot JSONB,
                   changed_at, change_source ADMIN|AI|SYSTEM, change_note)
QUESTION_LIFECYCLE_EVENT (event_id, question_id, from_status, to_status, created_at, reason)
```

«Сыгран» / «проверен игрой» — производные из QUESTION_STATS, а не статусы. GOLD eligibility: times_played ≥ threshold, bad_rate и skip_rate < threshold, accuracy в целевом диапазоне, fact VERIFIED + ручное решение.

## 6. Repeat Prevention

Основной источник — `composition_state.used_fact_ids` (быстро). Для восстановления:

```sql
SELECT DISTINCT q.fact_id
FROM game_question gq
JOIN question q USING (question_id)
JOIN game_session gs USING (game_session_id)
WHERE gs.room_id = :room_id
  AND gq.status IN ('PRESENTING','ANSWERING','REVEALED','SKIPPED','CANCELLED');
```

Presented = consumed, включая skipped.

## 7. Retention

| Persistent | Temporary (до закрытия Room + retention) |
|---|---|
| Topics, contexts, families, facts, sources | Room, Player, tokens |
| Questions, options, media, rights | Individual onboarding, age band, topics, cultural contexts |
| Question / option stats, revisions | Individual answers и feedback с player_id |
| Aggregated analytics, group profile snapshots | `hero_candidate_player_id`, `selection_debug` |

Перед удалением агрегируются обезличенно: accuracy, response time, distribution, feedback, skip events, Hero aggregate, Play Again Intent.

## 8. Модули БД

- **Game Runtime:** room, player, game_session, player_onboarding, player_topic_preference, player_cultural_context, group_profile_snapshot, game_question, player_answer, session_feedback, question_feedback, session_event.
- **Content Intelligence:** question_family, fact, fact_source, question, question_option, question_topic, question_context, question_generation, question_effect, topic, cultural_context.
- **Media:** media_asset, media_rights.
- **Analytics / Editorial:** question_stats, answer_option_stats, question_revision, question_lifecycle_event.

## 9. Content Files (MVP)  `[D-04]`

В MVP банк живёт в репозитории (US-BANK-005). Файл содержит список families — обычно по одной теме (`content/families/<topic>.yaml`). Схема — `packages/content-schema/src/schema.ts`. Варианты ответа перемешиваются движком при показе, порядок в файле не важен.

```yaml
families:
  - family: tv-kukly
    name: "«Куклы»"
    facts: [...]
```

Пример одного факта:

```yaml
family: tv-kukly
facts:
  - id: kukly-channel-ntv
    statement: "Программа «Куклы» выходила на НТВ."
    sources:
      - {name: "...", url: "...", type: REFERENCE}
    questions:
      - id: kukly-channel-ntv-ru-1
        language: ru
        origin_language: ru
        culture_specificity: LOCAL
        is_bridge: false
        text: "На каком телеканале выходила программа «Куклы»?"
        options:
          - {key: A, text: "НТВ", correct: true}
          - {key: B, text: "ОРТ", distractor: SAME_CATEGORY}
          - {key: C, text: "РТР", distractor: SAME_CATEGORY}
          - {key: D, text: "ТВ-6", distractor: NEAR_MISS}
        explanation: "..."
        topics: {tv-90s-00s: 1.0}
        contexts: {POST_SOVIET: 1.0, RUSSIA_1990S: 1.0}
        generations: {90s: 1.0}
        difficulty: 3
        dignity: 2
        effects: {WHY_DO_I_REMEMBER_THIS: 1.0, I_KNOW_THIS: 0.7}
        age_safety: ALL
        status: APPROVED
        generation_method: HYBRID
```

## 10. Key Distinction

- **QUESTION** — что мы вообще можем спросить.
- **GAME_QUESTION** — когда, почему и в каком контексте мы показали его этой комнате.
- **FACT** — какое конкретное знание проверяем.

Эти три сущности нельзя сливать: они одновременно дают персонализацию, отсутствие повторов, аналитику, несколько формулировок и языковых версий одного факта, AI generation и Gold.

Внутренние IDs — UUID; человекочитаемые slugs для topic, context, family. Текст вопроса не используется как identifier.
