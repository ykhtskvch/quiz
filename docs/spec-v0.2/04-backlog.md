# 04 — Product Backlog v0.2

> Источник: Full Jira Backlog v0.1 + приоритизация из FR-doc v0.1. Нумерация эпиков канонична (T-02). Приоритеты пересмотрены по D-03 / D-15.

## 1. Conventions

**Priorities**

| Метка | Значение |
|---|---|
| **P0 — MVP** | Входит в первую проверяемую версию: играбельный скелет **плюс минимальное ядро отличий** (Hero, Dignity, культурный контекст). `[D-03]` |
| P1 | Social polish и качество; сразу после MVP. |
| P2 | Rich experience. |
| P3 | Future expansion. |

**Story ID:** `US-<EPIC>-NNN`. Каждая story: priority, dependencies, acceptance criteria.

**Jira hierarchy:** Initiative «Personalised Social Quiz» → Epic → Feature → User Story → Technical Tasks → Subtasks / Bugs.

## 2. MVP scope `[D-03]`

| Входит | Не входит |
|---|---|
| Room, QR, nickname, onboarding с культурным бэкграундом | Late join, полноценный reconnect (кроме refresh) |
| Composition: filter → score → top-N → weighted random | Audio, video, rights workflow |
| `hero_need` (минимальная версия) | In-product AI pipeline, admin portal |
| Cultural Dignity: score вопроса + медиана комнаты | Gold, semantic dedup |
| Cultural context теги + профиль | Автокалибровка сложности |
| Text + image (own / PD) | Donation |
| Reveal, распределение, scoring, final leaderboard | Accessibility сверх базового |
| Pause / Resume / Skip / End `[D-15]` | Английский язык |
| Play Again Intent, difficulty feedback, Great / Bad | |
| Банк ~300–500 вопросов на русском в файлах репо `[D-04]` | |

---

## EPIC 1 — Room Lifecycle

Цель: быстро создать временную комнату без аккаунтов.

| ID | Story | P | Deps | Acceptance Criteria |
|---|---|---|---|---|
| US-ROOM-001 | Create Room | P0 | — | `Create Quiz` создаёт `room_id`, 6-символьный код, QR и первую Game Session (ONBOARDING). Email/password не запрашиваются. Room → WAITING. |
| US-ROOM-002 | Join via code | P0 | ROOM-001 | Действующий код открывает onboarding; неверный / истёкший — понятная ошибка; rate limiting. |
| US-ROOM-003 | Join via QR | P0 | ROOM-001 | QR открывает Room без ввода кода; не содержит приватных данных. |
| US-ROOM-004 | Close / expire Room | P0 | — | После закрытия старый код не работает; temporary data очищаются по retention policy. Expiry после 6–12 ч неактивности. |

## EPIC 2 — Player Identity & Presence

| ID | Story | P | Deps | Acceptance Criteria |
|---|---|---|---|---|
| US-PLAYER-001 | Temporary nickname | P0 | — | Без аккаунта; виден в waiting room и leaderboard; дубликаты различаются. |
| US-PLAYER-002 | Anonymous session token | P0 | — | Временный token, связан с player_id в Room, хранится как hash. Refresh восстанавливает игрока. |
| US-PLAYER-003 | Reconnect after disconnect | P1 | PLAYER-002 | Восстанавливаются nickname, score, room state; новый player не создаётся. |
| US-PLAYER-004 | Presence status | P0 | — | `PLAYER.status = PENDING / ACTIVE / DISCONNECTED / LEFT` `[T-04]`. DISCONNECTED после timeout не блокирует reveal. |

## EPIC 3 — Private Onboarding

| ID | Story | P | Deps | Acceptance Criteria |
|---|---|---|---|---|
| US-ONB-001 | Private onboarding | P0 | — | Только на телефоне; display показывает лишь `Ready`; host не видит preferences. |
| US-ONB-002 | Age band | P0 | — | 13–17 / 18–24 / 25–34 / 35–44 / 45–54 / 55+. |
| US-ONB-003 | Select interests | P0 | TAX-001 | Визуальные карточки, multi-select, broad и niche. |
| US-ONB-004 | Less of this | P0 | — | Снижает вес, не запрещает. |
| US-ONB-005 | Knowledge depth | P0 | ONB-003 | Casual / Interested / Expert для выбранной темы. Нужен для `hero_need`. Wording — UX-тест. |
| US-ONB-006 | Cultural Dignity preference | P0 | — | 3 варианта → 4 / 3 / 2 `[D-13]`. Без слова «cringe». |
| US-ONB-007 | Fast late-join onboarding | P1 | LATE-001 | Минимум шагов: age + 3–5 тем. |
| US-ONB-008 | Cultural background | P0 | TAX-003 | Необязательный шаг «С какой культурой ты вырос(ла)?», multi-select. При пропуске — вывод из тем `[D-01]`. |

## EPIC 4 — Interest Taxonomy

Стартовый список тем — [08-topics-mvp.md](08-topics-mvp.md).

| ID | Story | P | Acceptance Criteria |
|---|---|---|---|
| US-TAX-001 | Browse topics | P0 | Выбор из controlled taxonomy (2 уровня в MVP). |
| US-TAX-002 | Related topic expansion | P1 | После выбора broad темы предлагаются более конкретные. |
| US-TAX-003 | Cultural context tags | P0 | GLOBAL, POST_SOVIET, UK, US, EUROPE, …; у темы есть `implied_context` для вывода D-01. |
| US-TAX-004 | Generation tags | P0 | 80s / 90s / 00s / 10s / current. |
| US-TAX-005 | Admin taxonomy management | P2 | Добавление, объединение, переименование, деактивация. В MVP — файл в репо. |

## EPIC 5 — Group Profile Engine

| ID | Story | P | Acceptance Criteria |
|---|---|---|---|
| US-GROUP-001 | Aggregate interests | P0 | `topic_score(room, topic)` из индивидуальных preferences. |
| US-GROUP-002 | Protect minority interests | P1 | Интерес одного не получает weight = 0. |
| US-GROUP-003 | Aggregate Dignity | P0 | Медиана; individual settings не раскрываются. |
| US-GROUP-004 | Mixed generation profile | P1 | Профиль отражает несколько поколений. |
| US-GROUP-005 | Minor presence flag | P0 | Игрок 13–17 → `minor_present = true`. |
| US-GROUP-006 | Cultural context profile | P0 | Веса контекстов комнаты из ONB-008 / вывода. |

## EPIC 6 — Question Data Model

| ID | Story | P | Acceptance Criteria |
|---|---|---|---|
| US-QMODEL-001 | Core metadata | P0 | question_id, fact_id, family_id, language, origin_language, text, options, correct, explanation. |
| US-QMODEL-002 | Personalisation metadata | P0 | topics, cultural contexts, culture_specificity, is_bridge, generation relevance, difficulty, dignity, knowledge effects. |
| US-QMODEL-003 | Media metadata | P0 (image) / P2 | media_asset_id, presentation_duration_ms, answer_time_override, fallback_question_id. |
| US-QMODEL-004 | Performance metadata | P1 | times_played, accuracy, skip_rate, bad_rate, avg response time, distractor distribution. |

## EPIC 7 — Question Bank

| ID | Story | P | Acceptance Criteria |
|---|---|---|---|
| US-BANK-001 | Only approved in play | P0 | Composition видит только APPROVED и GOLD. |
| US-BANK-002 | Filter bank | P0 | По topic, context, language, difficulty, age rules, dignity, effect, rights. |
| US-BANK-003 | Lifecycle | P0 | `DRAFT → FACT_CHECKED → APPROVED → GOLD`, `RETIRED` `[T-01]`. |
| US-BANK-004 | Retire question | P1 | RETIRED не появляется в live. |
| US-BANK-005 | Import from files | P0 | Банк загружается из YAML/JSON в репо с валидацией схемы. |

## EPIC 8 — Knowledge Effect Model

| ID | Story | P | Acceptance Criteria |
|---|---|---|---|
| US-KE-001 | Tag knowledge effect | P0 | Один или несколько эффектов с весами. |
| US-KE-002 | Balance effects | P1 | Мягкая цель; не 20 подряд obscure-вопросов. |
| US-KE-003 | Hero candidate detection | P0 | Сравнение metadata с individual affinity. |

## EPIC 9 — Cultural Dignity Engine

| ID | Story | P | Acceptance Criteria |
|---|---|---|---|
| US-DIGNITY-001 | Dignity score | P0 | 1–5 у вопроса; игрок не видит. |
| US-DIGNITY-002 | Dignity-based selection | P0 | Room preference задаёт распределение, а не фильтр. |
| US-DIGNITY-003 | Serious wording constraint | P0 | Гайдлайн для AI-драфтов и редактора (EPIC 35). |

## EPIC 10 — Cultural & Generation Engine

| ID | Story | P | Acceptance Criteria |
|---|---|---|---|
| US-CULT-001 | Post-Soviet layer | P0 | ТВ 90-х/00-х, попса, реклама, продукты, старый интернет, артефакты, public figures. |
| US-CULT-002 | International cultural mix | P2 | Для EN-комнат; вместе с EPIC 36. |
| US-CULT-003 | Cross-generation / bridge question | P1 | `is_bridge`, boost в mixed rooms. |
| US-CULT-004 | Minority generation protection | P1 | Минимум 10–15 % generation-relevant opportunities. |

## EPIC 11 — Age-Aware Safety

| ID | Story | P | Acceptance Criteria |
|---|---|---|---|
| US-SAFE-001 | Filter explicit 18+ | P0 | `minor_present` → explicit content не eligible. |
| US-SAFE-002 | Allow borderline non-explicit | P1 | Dating, relationships, mildly suggestive, awkward — допустимы. |

## EPIC 12 — Quiz Composition Engine

Дизайн — [05-composition-engine.md](05-composition-engine.md).

| ID | Story | P | Acceptance Criteria |
|---|---|---|---|
| US-COMP-001 | Compose next question | P0 | Жадный выбор по шагам `[D-05]`: profile + bank + used facts + rules → следующий вопрос. |
| US-COMP-002 | Shared interest questions | P0 | Часть sequence — пересекающиеся интересы. |
| US-COMP-003 | Minority questions | P1 | Резерв под low-frequency interests. |
| US-COMP-004 | Hero candidates | P0 | Распределение по игрокам через `hero_need`. |
| US-COMP-005 | Wildcards | P0 | 10–20 % вне declared interests. |
| US-COMP-006 | Difficulty balance | P0 | Room difficulty по стартовому правилу `[D-07]`; цель 50–70 %. |
| US-COMP-007 | Topic diversity | P1 | Diversity penalties. |
| US-COMP-008 | Expand topic ring | P1 | subtopic → parent → related → wildcard. |
| US-COMP-009 | Opening constraints | P0 | Первые 2–3 вопроса: ≤ medium, широкий охват, без крайних ниш. |
| US-COMP-010 | Persist engine state | P0 | `composition_state` в Game Session `[T-07]`. |

## EPIC 13 — Duplicate Prevention

| ID | Story | P | Acceptance Criteria |
|---|---|---|---|
| US-DEDUP-001 | Question ID exclusion | P0 | |
| US-DEDUP-002 | Fact ID exclusion | P0 | Включая skipped (presented = consumed). |
| US-DEDUP-003 | Play Again history | P1 | Накопленные used fact_ids Room. |
| US-DEDUP-004 | Semantic duplicates | P2 | Embedding-проверка. |

## EPIC 14 — Shared Display

| ID | Story | P | Acceptance Criteria |
|---|---|---|---|
| US-DISPLAY-001 | Question screen | P0 | Вопрос, media, варианты, таймер. |
| US-DISPLAY-002 | Answer count | P0 | `6/7 answered` без раскрытия ответов. |
| US-DISPLAY-003 | Reveal screen | P0 | Правильный ответ, explanation, distribution. |
| US-DISPLAY-004 | Voice reading | P2 | TTS; таймер не стартует до конца чтения. |

## EPIC 15 — Mobile Player

| ID | Story | P | Acceptance Criteria |
|---|---|---|---|
| US-MOBILE-001 | Select answer | P0 | Ответ фиксируется. |
| US-MOBILE-002 | Submission confirmation | P0 | «Ответ принят». |
| US-MOBILE-003 | Prevent multiple submission | P0 | Один scored answer. |
| US-MOBILE-004 | Personal result | P0 | После reveal: `Верно +1 084`, без места в рейтинге. |

## EPIC 16 — Game Timing

| ID | Story | P | Acceptance Criteria |
|---|---|---|---|
| US-TIME-001 | Presentation phase | P0 | Восприятие до старта таймера. |
| US-TIME-002 | Standard timer | P0 | 15 с, конфиг. |
| US-TIME-003 | Question-specific timer | P1 | По metadata. |
| US-TIME-004 | End early if all answered | P0 | |
| US-TIME-005 | Timer sync | P0 | `serverNow` + `remainingMs` `[T-03]`. |
| US-TIME-006 | Auto-advance after reveal | P0 | Через 10–15 с; NEXT у хоста необязателен. |

## EPIC 17 — Scoring

| ID | Story | P | Acceptance Criteria |
|---|---|---|---|
| US-SCORE-001 | Correct answer score | P0 | ✅ 3 / 2 / 1 по скорости, 0 за неверный (плейтест 1; было 1000). |
| US-SCORE-002 | Speed bonus | P0 | ✅ Скорость входит в 3 / 2 / 1 (плейтест 1; было «до 150, линейно»). |
| US-SCORE-003 | Reading-speed fairness | P1 | Бонус остаётся малой долей score. |
| US-SCORE-004 | No live leaderboard | P0 | |

## EPIC 18 — Host Controls

| ID | Story | P | Acceptance Criteria |
|---|---|---|---|
| US-HOST-001 | Start | P0 | ≥ 2 игроков `[D-12]`. |
| US-HOST-002 | Pause / Resume | P0 `[D-15]` | |
| US-HOST-003 | Skip | P0 `[D-15]` | PRESENTING / ANSWERING; ответы аннулируются `[D-10]`. |
| US-HOST-004 | End Game | P0 | В любой момент `[D-11]`. |
| US-HOST-005 | Continue beyond 30 min | P1 | `Продолжить` / `Закончить и посмотреть результаты`. |

## EPIC 19 — Late Join

| ID | Story | P | Acceptance Criteria |
|---|---|---|---|
| US-LATE-001 | Join active room | P1 | Fast onboarding; status PENDING → ACTIVE со следующего вопроса; score с 0; hero boost ограничен `[D-14]`. |
| US-LATE-002 | Accuracy for late player | P2 | Correct / Attempted. |

## EPIC 20 — Image Questions

| ID | Story | P |
|---|---|---|
| US-IMG-001 | Display image question | P0 |
| US-IMG-002 | Image rights (own / PD only) | P0 |
| US-IMG-003 | Attribution | P2 |
| US-IMG-004 | Image failure fallback | P1 |

## EPIC 21 — Audio Questions — P2

US-AUD-001 Play before timer · US-AUD-002 Replay rules · US-AUD-003 Licensed audio only.

## EPIC 22 — Video Questions — P2

US-VID-001 Presentation · US-VID-002 Start/stop timestamp · US-VID-003 Avoid answer spoilers (title / thumbnail) · US-VID-004 Fallback.

## EPIC 23 — Media Rights Management

| ID | Story | P |
|---|---|---|
| US-RIGHTS-001 | Rights metadata | P0 (минимальный набор полей) |
| US-RIGHTS-002 | Approval gate | P0 |
| US-RIGHTS-003 | Rights review queue | P2 |

## EPIC 24 — In-product AI Pipeline

Офлайн-генерация для MVP — в EPIC 35.

| ID | Story | P |
|---|---|---|
| US-AI-001 | Generate draft question (DRAFT) | P1 |
| US-AI-002 | Generate distractors | P1 |
| US-AI-003 | Generate explanation | P1 |
| US-AI-004 | Auto-tag | P1 |
| US-AI-005 | Long-tail generation | P2 |

## EPIC 25 — Fact Checking

US-FACT-001 Sources (P0 — у каждого факта ≥ 1 источник) · US-FACT-002 Fact-check status (P0) · US-FACT-003 Stale question review (P2).

## EPIC 26 — Gold Questions

US-GOLD-001 Promote (P1) · US-GOLD-002 Behavioural signals (P2) · US-GOLD-003 Gold weighting (P2).

## EPIC 27 — End Game

| ID | Story | P | Acceptance Criteria |
|---|---|---|---|
| US-END-001 | Final leaderboard | P0 | |
| US-END-002 | Winner reveal | P0 | |
| US-END-003 | Hardest Question | P1 | |
| US-END-004 | Everyone Knew This | P1 | |
| US-END-005 | Only One Knew | P1 | Без имени; не при < 4 `[D-09, D-12]`. |
| US-END-006 | Fastest Correct | P1 | С именем. |
| US-END-007 | Most Divided | P1 | Copy не оценивает тему как «cringe». |

## EPIC 28 — Offboarding

US-OFF-001 Difficulty (P0) · US-OFF-002 Pace (P1) · US-OFF-003 Cultural balance (P1) · US-OFF-004 Would you play again? (P0, core KPI) · US-OFF-005 Different group (P1) · US-OFF-006 More / less content (P1).

## EPIC 29 — Question Feedback

US-FEED-001 Great / Fine / Bad (P0) · US-FEED-002 Skip rate (P0 — событие логируется) · US-FEED-003 Review trigger (P1).

## EPIC 30 — Analytics

US-AN-001 Play Again Intent (P0) · US-AN-002 Actual Play Again (P1) · US-AN-003 Session duration (P1) · US-AN-004 Questions per session (P1) · US-AN-005 Early finish rate (P1) · US-AN-006 Average accuracy (P1) · US-AN-007 Question performance (P1) · US-AN-008 Hero Moment proxy (P1 — ключевая для проверки гипотезы).

## EPIC 31 — Donations — P2

US-DON-001 Post-game CTA · US-DON-002 Shared-screen QR · US-DON-003 Permanent link · US-DON-004 Analytics без identity.

## EPIC 32 — Admin Portal — P2

US-ADM-001…010: list, create/edit, review AI, metadata, sources, media rights, performance dashboard, retire, gold, taxonomy. В MVP заменяется файлами в репо + скриптами (EPIC 35).

## EPIC 33 — Accessibility

US-ACC-001 High contrast (P0) · US-ACC-002 A/B/C/D, не только цвет (P0) · US-ACC-003 Scalable text (P1) · US-ACC-004 Captions (P2) · US-ACC-005 Reduced motion (P2).

## EPIC 34 — Custom Questions — P3

US-CUSTOM-001 Private question for room · US-CUSTOM-002 Birthday / friends pack · US-CUSTOM-003 Moderation (не в global bank автоматически).

## EPIC 35 — Content Production `[D-04]` — P0, параллельно волне 1

Цель: банк для MVP — **300–500 вопросов на русском**, ~30 тем × 10–15 + ~100 wildcard / shared.

| ID | Story | Acceptance Criteria |
|---|---|---|
| US-CONT-001 | Question file schema | YAML/JSON-схема по [06-data-model.md](06-data-model.md); валидатор в CI. |
| US-CONT-002 | Editorial guideline | Серьёзный тон, типы distractors, explanation, Dignity-шкала с примерами, правила 13–17, правило непереводимости. |
| US-CONT-003 | AI draft script | Скрипт генерирует DRAFT-вопросы по теме, контексту и сложности с источниками. |
| US-CONT-004 | Manual review pass | Каждый вопрос проверен человеком → FACT_CHECKED → APPROVED. |
| US-CONT-005 | Coverage report | Сколько APPROVED по теме × difficulty × dignity × generation; подсветка дыр. |
| US-CONT-006 | Images (own / PD) | Для image-вопросов — только собственные или PD с rights metadata. |

## EPIC 36 — English Language & International Mix — ✅ (сделан раньше плана)

EN-интерфейс, EN-банк (GLOBAL / UK / US + bridge), US-CULT-002, NFR-011. Выбор языка на главной; телефон берёт язык комнаты; onboarding показывает только темы с контентом в языке комнаты. Банк: 147 переводов + 39 EN-native черновиков.

## EPIC 37 — Playtest 1 feedback (2026-10-05)

Первый живой плейтест: 2 игрока, общий экран на ноутбуке. Фидбек — про подачу и поток экранов, к содержанию вопросов претензий почти нет («что знал — легко, что не знал — сложно, кое-что угадал»).

**Сделано сразу:** игра — 20 вопросов, «Вопрос N из 20» на экране и телефоне (BR-010); очки 3 / 2 / 1 (BR-079), правила видны в лобби; до 5 любимых и до 5 «поменьше» тем (BR-021), в онбординге сначала основные темы, остальные — «Показать все темы».

| ID | Story | P | Что сказали → что сделать |
|---|---|---|---|
| US-PT1-001 | Timer direction | P0 ✅ | Полоска «ездит туда-сюда» и убывает. → Одна полоска только на время ответа, заполняется слева направо, в последние 5 с меняет цвет / пульсирует. На показе вопроса и reveal полоски нет. **Сделано:** `AnswerTimer` — только в фазе ответа, слева направо, последние 5 с красная пульсация (без анимации при prefers-reduced-motion). |
| US-PT1-002 | Stable layout | P0 ✅ | Глаза мечутся, экран перестраивается. → Вопрос всегда наверху на одном месте, варианты появляются внизу статично — и на общем экране, и на телефоне; элементы не прыгают ни в одном viewport. **Сделано:** на общем экране и телефоне вопрос наверху во всех фазах, места под варианты A–D зарезервированы с показа вопроса, слоты таймера и ответа фиксированной высоты; замер — 0 px сдвига между фазами. |
| US-PT1-003 | Big correct answer | P0 ✅ | Правильный ответ мелкий. → Крупно, на всю ширину экрана reveal. **Сделано:** крупная плашка «Правильный ответ» в нижнем слоте общего экрана и на телефоне. |
| US-PT1-004 | «Did you know?» beat | P1 ✅ | Пояснение теряется. → Отдельный короткий шаг после ответа — заодно передышка. **Сделано:** reveal 10 с: первые 4 с — ответ, затем на месте вариантов карточка «А вы знали?» с пояснением и правильным ответом (`revealFactAfterMs`); вопрос и шапка не двигаются. |
| US-PT1-005 | Between-question pacing | P0 ✅ | Reveal (10 с) длиннее показа вопроса (2,5–7 с), между вопросами суетно. → Перебалансировать тайминги; перед вопросом «Готовы? 3… 2… 1…»; на reveal — «Следующий через 3 · осталось 13». **Сделано:** показ вопроса 4–9 с (было 2,5–7), reveal 8 с (было 10); на reveal «Следующий вопрос через N · осталось M», в последние 3 с — акцентом. Отдельный экран «Готовы? 3… 2… 1…» не делали: эту роль играет отсчёт на reveal. |
| US-PT1-006 | Points feedback per question | P1 ✅ | Непонятно, сколько дали. → «+3 · быстро» на телефоне и короткая таблица очков на общем экране после reveal. **Сделано:** на телефоне «+3 · быстро» / «+2 · вовремя» / «+1 · в последний момент». Таблицу очков на общем экране во время игры не делаем — решение 2026-10-05: BR-080 и US-SCORE-004 остаются в силе. |
| US-PT1-007 | Results heading | P1 ✅ | «Место 1 из 2» выглядит странно. → «1-е место», мелко «(из 2)»; больше воздуха вокруг заголовка, очков и числа вопросов. **Сделано:** «1-е место (из 2)» крупно, под ним очки и «верно из», больше воздуха вокруг. |
| US-PT1-008 | Split offboarding | P0 ✅ | Анкета и оценка вопросов на одном экране — ощущается как обязаловка. → Шаг 1: короткая анкета → «Отправить». Шаг 2: «Хотите оценить вопросы?» (opt-in). **Сделано:** сначала короткая анкета, после отправки — «Спасибо» и предложение оценить вопросы по кнопке; для не-ведущих — «Ждём, пока ведущий начнёт новую игру» (часть US-PT1-010). |
| US-PT1-009 | Question rating layout | P1 ✅ | Тяжело листать. → Текст вопроса сверху, 👍 / 👌 / 👎 под ним; первые 5 и «Показать ещё»; подпись «плохие отправим на переписку» заметнее. **Сделано:** текст вопроса сверху, три кнопки равной ширины под ним; по 5 вопросов, «Показать ещё 5»; подсказка про переписку — отдельной плашкой. |
| US-PT1-010 | After-send state | P1 ✅ | Непонятно, как выйти. → Явное «Ждём, пока ведущий начнёт новую игру»; «Изменить интересы» — перед новой игрой, а не в анкете. **Сделано:** «Ждём, пока ведущий начнёт новую игру» после анкеты; «Изменить интересы» появляется только после отправки анкеты. |
| US-PT1-011 | Spacing & form controls | P1 ✅ | Всё «сжато». → Отступы между блоками и над кнопками, одинаковая min-height у селекторов, длинный текст не растягивает элемент; контраст размера / веса / цвета для главного действия. **Сделано:** отступы в итогах и анкете, кнопка отправки отделена; у переключателей равные колонки `minmax(0, 1fr)` и min-height — длинная подпись переносится внутри, а не растягивает элемент. |
| US-PT1-012 | Harder vehicle question | P2 | Only Fools: лёгкая версия честная, но можно сложнее. → Второй вопрос к тому же факту: модель фургона (Reliant Regal; Reliant Robin как частое заблуждение). |
| US-PT1-013 | New formats & topics | P2 | «Квинтэссенция британской реакции на…» (и для других культур); «самый унылый город Англии». |
| US-PT1-014 | Regional bonus round | P3 · post-MVP | Каждой подгруппе (напр. 2 из России, 2 из Англии) — бонусный вопрос «про свой регион», за 1 очко, чтобы не перекашивать итог. |
| US-PT1-015 | Sound effects | P3 · post-MVP | «Слишком тихо». Звуки начала вопроса, последних секунд, reveal. |
| US-PT1-016 | Borrow proven mechanics | P2 | Посмотреть, как это решено у Kahoot / Jackbox: отсчёт перед вопросом, раскладка, подача очков. |

Не баг: повторы вопросов были потому, что перед игрой их смотрели в инструменте проверки; движок не повторяет вопросы внутри игры и между играми комнаты.

Процесс: перед плейтестом очищать аналитику staging — в этот раз в ней остались smoke-игры, и отчёт по игре не получился.

---

## 3. Dependency Map

```
Room → Player Identity → Private Onboarding → Taxonomy → Group Profile
     → Question Model / Bank (+ Content Production) → Composition Engine
     → Shared Display + Mobile Player → Timing + Scoring + Reveal → End Game
```

Усилители движка: Knowledge Effects, Cultural Dignity, Cultural Context, Age Balance.
Контент: Content Production → Bank → (позже) AI Pipeline → Fact Checking → Gold → Analytics loop.
Media: Image / Audio / Video зависят от Media Rights.

## 4. Delivery Waves

| Волна | Цель | Состав |
|---|---|---|
| **1 — MVP** | Проверить идею, а не только техническую игру | Все P0: room, onboarding с контекстом и Dignity, composition с hero / dignity / context, display, mobile, timing, scoring, reveal, pause / skip / end, end game, базовый feedback. **Параллельно — EPIC 35.** |
| 2 — Social polish | Удобство вечера | Late join, reconnect, end-game statistics, полный offboarding, Play Again, 30-min soft ending, minority / diversity / topic ring. |
| 3 — Content quality engine | Масштаб контента | In-product AI pipeline, fact checking, calibration, Gold, semantic dedup, admin portal. |
| 4 — English & international | Второй язык | EPIC 36. |
| 5 — Rich media | | Audio, video, rights workflow, attribution. |
| 6 — Scale & refinement | | Advanced analytics, cultural bridge algorithm, auto calibration, accessibility, donation. |
| 7 — Expansion | | Custom questions, packs, continuity without accounts. |

## 5. Definition of Done — Feature

- business rule реализован;
- happy path протестирован, error state обработан;
- analytics event определён, если нужен;
- приватность соблюдена (приватные поля не уходят в общий канал);
- mobile и shared display согласованы;
- accessibility рассмотрено;
- no-account principle не нарушен;
- данные / контент задокументированы.

## 6. Definition of Done — Question Content

- однозначный правильный ответ;
- разумные distractors с типами;
- explanation;
- fact checked, ≥ 1 источник;
- topics, cultural context, culture_specificity, generation, difficulty, dignity, age safety заполнены;
- media rights подтверждены, если есть media;
- fact_id и family_id назначены, duplicate check пройден;
- проверен человеком;
- status = APPROVED или выше.

## 7. Product Backbone

1. **Room** — кто сейчас играет.
2. **Player Profile** — что интересно каждому сегодня.
3. **Question Intelligence** — что представляет каждый вопрос и какое ощущение даёт.
4. **Composition Engine** — что показать этой комнате и в каком порядке.
5. **Feedback Loop** — сработал ли вопрос и хочется ли сыграть ещё.
