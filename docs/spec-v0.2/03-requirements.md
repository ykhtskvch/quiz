# 03 — Functional & Non-Functional Requirements v0.2

> Источник: Functional Requirements & Backlog Structure v0.1. Приоритизация и эпики перенесены в [04-backlog.md](04-backlog.md). Изменения помечены `[D-xx]` / `[T-xx]`; новые требования — FR-062+, NFR-016+.

## 1. Gameplay Requirements

| ID | Название | Требование |
|---|---|---|
| FR-001 | Room creation | Создать временную Room без регистрации; вместе с ней создаётся первая Game Session. `[D-08]` |
| FR-002 | Room join | Подключиться по QR или короткому room code. |
| FR-003 | Temporary nickname | Задать временное имя, действующее только в текущей Room. |
| FR-004 | Private onboarding | Индивидуальный onboarding на устройстве игрока. |
| FR-005 | Interest selection | Выбор тем из контролируемой taxonomy. |
| FR-006 | Negative preference | Отметить темы, которых хочется меньше. |
| FR-007 | Age band | Выбрать возрастную группу. |
| FR-008 | Knowledge depth | Указать уровень интереса / знания по выбранной теме (Casual / Interested / Expert). |
| FR-009 | Cultural Dignity preference | Приватно выбрать один из трёх вариантов баланса. `[D-13]` |
| FR-062 | Cultural background | Необязательно выбрать культурные контексты взросления; при пропуске система выводит их из тем. `[D-01]` |
| FR-010 | Group profile | Агрегировать onboarding всех игроков в скрытый профиль комнаты (snapshot при Start, обновление при late join). |
| FR-011 | Question selection | Подбирать вопросы на основании профиля комнаты. |
| FR-012 | Minority-interest protection | Учитывать интересы меньшинства. |
| FR-013 | Hero Moment candidate | Стремиться подобрать ≥ 1 specialist question для каждого игрока. |
| FR-014 | Wildcard selection | Часть вопросов — вне прямых интересов. |
| FR-015 | Cultural-context mix | Смешивать культурные контексты, присутствующие в комнате. |
| FR-063 | Room language | Room имеет один язык (MVP: `ru`); показываются только вопросы на этом языке. `[D-02]` |
| FR-064 | Non-translatable content | Культурно-специфичные (LOCAL) вопросы не существуют в переводе; фильтр по `language = room.language`. `[D-02]` |
| FR-016 | Age-balanced selection | Учитывать разные поколения внутри комнаты. |
| FR-017 | Minor-aware filtering | При несовершеннолетних исключать explicit 18+. |
| FR-018 | Multiple choice | Один правильный вариант и несколько distractors. |
| FR-019 | Text question | Поддержка текстовых вопросов. |
| FR-020 | Image question | Поддержка вопросов с изображением. |
| FR-021 | Audio question | Поддержка аудио (не MVP). |
| FR-022 | Video question | Поддержка видео (не MVP). |
| FR-023 | Shared display | Вопросы показываются на общем экране. |
| FR-024 | Player answer input | Ответ выбирается на телефоне. |
| FR-025 | Answer timer | Таймер запускается после presentation phase. |
| FR-026 | Early reveal | Если ответили все активные — reveal сразу. |
| FR-027 | Correct-answer reveal | Показ правильного ответа после answer phase. |
| FR-028 | Explanation | Короткое объяснение факта. |
| FR-029 | Answer distribution | Распределение ответов без имён. |
| FR-030 | Scoring | Баллы за правильный ответ. |
| FR-031 | Speed bonus | Небольшой бонус за скорость. |
| FR-032 | Hidden leaderboard | Место не показывается во время игры. |
| FR-033 | Final leaderboard | Итоговый рейтинг после игры. |
| FR-034 | Early finish | Хост завершает игру в любой момент; незавершённый вопрос аннулируется. `[D-11]` |
| FR-035 | Pause | Пауза. |
| FR-036 | Resume | Продолжение с восстановлением оставшегося времени. |
| FR-037 | Skip | Пропуск в PRESENTING / ANSWERING; ответы аннулируются, факт использован. `[D-10]` |
| FR-038 | Late join | Подключение после начала игры. |
| FR-039 | Reconnect | Восстановление сессии после потери соединения. |
| FR-040 | Session deduplication | Вопрос не повторяется в активной Room. |
| FR-041 | Fact deduplication | Факт не повторяется в другой формулировке. |
| FR-042 | Play Again | Новая игра в той же Room без повторения fact_id. |
| FR-043 | Post-game statistics | Игровые агрегаты после игры. |
| FR-044 | Hardest Question | Вопрос с минимальной долей правильных. |
| FR-045 | Only One Knew | Вопрос, где правильно ответил ровно один; **без имени**; не показывается при < 4 игроках. `[D-09, D-12]` |
| FR-046 | Most Divided Question | Наиболее равномерное распределение ответов. |
| FR-047 | Offboarding | Короткий приватный feedback flow. |
| FR-048 | Play-again intent | Вопрос «сыграл бы ещё?». |
| FR-049 | Question feedback | Оценка конкретного вопроса. |
| FR-050 | Donation CTA | Добровольный CTA после игры. |
| FR-065 | Minimum players | Start доступен при ≥ 2 игроках. `[D-12]` |

## 2. Content Management Requirements

| ID | Название | Требование |
|---|---|---|
| FR-051 | Question metadata | Структурированные metadata — полный список в [06-data-model.md §QUESTION](06-data-model.md). Обязательно: question_id, fact_id, family_id, topics, language, origin_language, culture_specificity, cultural contexts, generation relevance, difficulty, Cultural Dignity, Knowledge Effects, options, explanation, media, rights status. |
| FR-052 | Question lifecycle | `DRAFT → FACT_CHECKED → APPROVED → GOLD`, `RETIRED` из любого состояния. `[T-01]` |
| FR-053 | Editorial review | Проверка и изменение вопроса до публикации (в MVP — в файлах репозитория). |
| FR-054 | Performance analytics | Accuracy, skip rate, negative feedback, distribution, play count. |
| FR-055 | Gold promotion | Повышение проверенного вопроса до GOLD. |
| FR-056 | Retirement | Исключение плохого / устаревшего вопроса. |
| FR-057 | Semantic duplicates | Выявление вопросов, проверяющих один факт. |
| FR-066 | Content import | Импорт банка из структурированных файлов (YAML / JSON) с валидацией схемы. `[D-04]` |

## 3. Media Rights Requirements

| ID | Название | Требование |
|---|---|---|
| FR-058 | Rights metadata | Источник и лицензия у каждого media asset. |
| FR-059 | Publication gate | Asset без подтверждённых прав не попадает в live. |
| FR-060 | Attribution | Показ attribution, если лицензия требует. |
| FR-061 | Media fallback | Fallback или замена вопроса до показа. |

## 4. Non-Functional Requirements

| ID | Название | Требование |
|---|---|---|
| NFR-001 | Performance | UI transitions < 1 с; подтверждение ответа < 500 мс в типичных условиях. |
| NFR-002 | Room stability | 2–8 игроков без деградации. |
| NFR-003 | Resilience | Потеря соединения одним игроком не блокирует игру. |
| NFR-004 | Reconnection | Восстанавливаются nickname, score, room state. |
| NFR-005 | Privacy | Onboarding preferences недоступны другим игрокам; приватные поля не отправляются в общий канал. |
| NFR-006 | Data minimisation | Без email, пароля, постоянного профиля. |
| NFR-007 | Accessibility | Контраст, читаемые шрифты, keyboard accessibility, subtitles / transcripts для media, ответы различимы не только цветом (A/B/C/D). |
| NFR-008 | Mobile-first | Player UI оптимизирован под мобильный браузер. |
| NFR-009 | Cross-browser | Актуальные Safari, Chrome, Edge (mobile / desktop). |
| NFR-010 | Responsive display | Shared screen на laptop, desktop, TV / cast. |
| NFR-011 | Readable language | Тексты вопросов понятны игрокам с разным уровнем языка (актуально для EN). |
| NFR-012 | Content safety | Возрастные ограничения применяются до selection. |
| NFR-013 | Observability | Логирование ошибок, media failures, critical game-flow events. |
| NFR-014 | Auditability | История изменений, источник и статус опубликованного вопроса. |
| NFR-015 | Configurability | Timers, scoring, composition weights, prefetch size — конфигурация, а не код. |
| NFR-016 | Abuse protection | Room code — 6 символов без похожих (0/O, 1/I); rate limiting на join и reconnect; токены хранятся только как hash. `[T-08]` |
| NFR-017 | Timer sync | Клиент получает `serverNow` и `remainingMs`, считает offset; визуальный таймер не зависит от точности часов телефона. `[T-03]` |
