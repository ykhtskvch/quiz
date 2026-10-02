# 05 — Composition Engine Design v0.2

> Источник: Composition Engine Design v0.1. Применены D-02, D-05, D-06, D-07, D-14, T-07, T-10.

## 1. Purpose & Objective

Engine отвечает на вопрос: **какие вопросы показать именно этой комнате, чтобы им было интересно играть вместе?**

Оптимизируемая цель — **вероятность «I want to play again»**, а не средний score, не «каждому только его темы», не поиск самого эрудированного.

Внутренние proxy-цели:

1. большинство вопросов интересно хотя бы части комнаты;
2. каждый получает шанс проявить нишевое знание;
3. никто не оказывается культурно «за бортом»;
4. вопросы отличаются друг от друга;
5. accuracy ≈ 50–70 %;
6. есть и узнаваемые, и неожиданные темы;
7. квиз не превращается в предсказуемое отражение onboarding.

## 2. Architecture `[D-05]`

**Жадный выбор по шагам.** На каждом шаге выбирается один следующий вопрос. Заранее весь квиз не строится — это нужно для late join, skip, адаптации и игры дольше 30 минут.

Не «вот интересы 7 человек, придумай 25 вопросов» одним промптом. AI помогает с контентом; решение о выборе — структурированное и объяснимое.

```
1. Filter      — убрать всё неeligible
2. Score       — CandidateScore каждого кандидата
3. Boost       — hero_need, minority, generation
4. Penalise    — recent topic / context / effect / same-player hero
5. Window      — top N (по умолчанию 15)
6. Pick        — weighted random внутри окна
7. Update      — composition_state
8. Repeat
```

Варианты ответа перемешиваются при каждом показе (порядок в файле банка — редакционный и может быть неравномерным).

Движок заранее держит `prefetch_size` (по умолчанию 5) готовых кандидатов; если первый стал invalid — берётся следующий. `[T-09]`

## 3. Inputs

**Player profile** (временный, в пределах Game Session):

```
player_id, age_band,
interests[]  {topic_id, preference: LIKE|LESS_OF, depth: CASUAL|INTERESTED|EXPERT}
cultural_contexts[] {context_id, strength, source: DECLARED|INFERRED}   [D-01]
dignity_preference  (4 | 3 | 2)
```

**Question profile:** question_id, fact_id, family_id, language, origin_language, culture_specificity, is_bridge, topics[], cultural_contexts[], generation_relevance[], difficulty_global, cultural_dignity, knowledge_effects[], quality_score, status, age_safety, media_type, stats (times_played, accuracy, skip_rate, bad_rate).

**Room state** (`GAME_SESSION.composition_state`, `[T-07]`):

```
used_question_ids, used_fact_ids, recent_family_ids,
recent_topics, recent_contexts, recent_effects,
hero_need {player_id: 0..1},
hero_opportunities {player_id: count, last_index},
difficulty_history, question_index
```

## 4. Stage 1 — Eligibility Filter (жёстко)

Вопрос исключается, если:

- `language ≠ room.language` `[D-02]` (непереводимость обеспечивается на уровне контента — LOCAL-вопрос существует только на `origin_language`);
- status не APPROVED / GOLD;
- question_id или fact_id уже использован в Room;
- media недоступно или rights не VERIFIED;
- explicit 18+ при `minor_present`;
- правильный ответ помечен как неоднозначный;
- вопрос требует культурного контекста, которого нет ни у одного игрока, **кроме** случаев `is_bridge = true` или `culture_specificity = GLOBAL` `[T-10]`.

## 5. Stage 2 — Player Affinity

`Affinity(player, question) ∈ [0, 1]` — комбинация трёх компонент (стартовые значения, конфиг):

**Topic match**

| Предпочтение | Значение |
|---|---|
| LIKE + EXPERT | 1.0 |
| LIKE + INTERESTED | 0.8 |
| LIKE + CASUAL | 0.6 |
| нет предпочтения | 0.3 |
| LESS_OF | 0.1 |

**Cultural match:** strong = 1.0, partial / global = 0.6, no match = 0.2. INFERRED-контекст умножается на 0.7. Mismatch не исключает вопрос — он нужен для cross-cultural механики.

**Generation match:** эпоха взросления = 1.0, соседняя = 0.6, далёкая = 0.2.

## 6. Stage 3 — Room Relevance & Candidate Score

Не только среднее: аффинити `0.9, 0.9, 0.9, 0.1, 0.1, 0.1` и `0.5 × 6` дают одинаковое среднее, но это разные вопросы.

- **SharedScore** = среднее top 60 % player affinities (один LESS_OF не убивает вопрос, который любят пятеро).
- **MinorityScore** = max individual affinity (кандидаты в Hero).
- **HeroNeed** = `max(hero_need[p] × affinity[p])` по игрокам с affinity ≥ 0.8.

Стартовая формула (веса — конфиг, важен принцип: ни один сигнал не решает единолично):

```
CandidateScore =
  0.30 × SharedScore
+ 0.15 × MinorityScore
+ 0.10 × HeroNeed
+ 0.10 × CulturalFit
+ 0.10 × GenerationFit
+ 0.10 × DifficultyFit
+ 0.05 × DignityFit
+ 0.10 × QuestionQuality
```

**QuestionQuality:** editorial quality, fact confidence, accuracy calibration, positive feedback, skip rate, bad rate, GOLD boost. GOLD не должны заполнять весь квиз.

## 7. Priority of Goals `[D-06]`

Нижние уступают верхним.

| # | Цель | Тип |
|---|---|---|
| 1 | Eligibility / safety | жёстко |
| 2 | Дедупликация fact_id | жёстко |
| 3 | Ограничения первых 2–3 вопросов | жёстко |
| 4 | Покрытие Hero (каждый ≥ 1) | сильный boost |
| 5 | Целевая сложность | мягкая |
| 6 | Diversity penalties | мягкая |
| 7 | Распределение Dignity | мягкая |
| 8 | Микс Knowledge Effects | мягкая |

Мягкие цели влияют на score и **измеряются постфактум** (§16), но не являются квотами.

## 8. Room Difficulty `[D-07]`

Различаются `difficulty_global` (для своей целевой аудитории) и `room_difficulty`.

**Стартовое правило (до накопления статистики):**

```
room_difficulty = clamp(
  difficulty_global − 0.5 × share_of_players_with_match,
  1, 5)
```

где `share_of_players_with_match` — доля игроков с LIKE по теме вопроса или совпадающим cultural context. Коэффициент — конфиг.

Пример: «На каком канале выходила программа „Куклы“?» — global 3/5. Комната из 7 человек 35–45 лет с POST_SOVIET → ≈ 2.5. Если ни у кого нет POST_SOVIET и вопрос не bridge — не eligible (§4).

## 9. Soft Targets

**Difficulty** — accuracy ≈ 60 % (50–70). Ориентир на 25 вопросов: 5 easy / 10 medium / 7 hard / 3 specialist (по room difficulty).

**Knowledge Effects** — ≈ 25 % I_KNOW_THIS, 20 % WHY_DO_I_REMEMBER_THIS, 25 % I_FIGURED_IT_OUT, 20 % SHARED_KNOWLEDGE, 10 % HERO-heavy. Эффекты пересекаются (фото интерфейса ICQ: Hero для одного, Why Do I Remember для остальных).

**Composition mix** — 40 % shared, 20 % minority, 15 % hero candidates, 15 % wildcards, 10 % bridge / cross-cultural. Категории пересекаются.

**Dignity distribution** — Room preference задаёт распределение, а не фильтр:

| Room median | 5–4 (high) | 3 | 2 | 1 (low) |
|---|---|---|---|---|
| 4 (классика) | 35 % | 35 % | 20 % | 10 % |
| 3 (баланс) | 20 % | 35 % | 30 % | 15 % |
| 2 (поп-культура) | 10 % | 20 % | 35 % | 35 % |

Low dignity ≠ easy.

## 10. Hero Rules

- `hero_need` стартует с 1.0, снижается после hero-кандидата для игрока;
- цель — ≥ 1 hero-кандидат на игрока за ~25 вопросов;
- не более 2–3 явных specialist-кандидатов на одного;
- не два hero-вопроса одному подряд;
- hero-вопрос никак не маркируется в UI;
- Hero — возможность, а не гарантия правильного ответа.

**Late joiner** `[D-14]`: `hero_need = 1.0`, но boost активируется не раньше чем через 2 вопроса после входа и не чаще одного раза в окне из 5 вопросов.

## 11. Wildcards & Bridge

**Wildcards** (10–20 %): доступные, интересные, качественные, без узкого бэкграунда. GOLD хорошо подходят.

**Bridge questions** (`is_bridge = true`): связывают поколения или культуры — старая песня, ставшая популярной в TikTok; оригинал и ремейк; мем на основе старого объекта. Boost в mixed-age / mixed-culture комнатах. Проходят фильтр контекста (§4).

**Cross-cultural**: вопрос с культурным «хозяином», который остальные могут угадать (`culture_specificity = REGIONAL`, высокая guessability). Создаёт разговор «откуда ты это знаешь?».

## 12. Diversity Penalties

- **Topic:** два подряд одной темы → следующий ×0.5; три — сильнее.
- **Context:** три подряд одного контекста → penalty.
- **Effect:** три подряд сложных niche → penalty для следующего specialist.
- **Family:** вопрос той же family не ставится в ближайшие 3 позиции.
- **Same-player hero:** у игрока уже 2 hero-кандидата → его boost уменьшается.

## 13. Sequence Shape

Иллюстрация желаемой формы (не шаблон, `[D-05]`): Easy + Shared → Medium + cultural memory → другая тема → Hero → easy wildcard → Hard / I Figured It Out → low dignity → shared → Hero другому игроку → hard niche.

**Opening (жёстко, первые 2–3):** ≤ medium, широкий cultural reach, ≥ 1 узнаваемая тема, высокая quality, без крайних ниш и спорных edge cases. Цель — быстро доказать ценность игры.

**Mid-game:** более нишевые темы, сложные Hero, low-dignity cultural memory, cross-cultural.

**End-game (около 30 мин):** слегка выше difficulty и hero potential. При досрочном завершении специальных финальных вопросов нет.

## 14. Adaptation During Play

- Маленькие корректировки effective difficulty по теме по ходу игры (5 hard history с 90 % правильных → история «легче»). Три ответа — слабый сигнал; изменения малы.
- Интересы по поведению **не выводятся**: правильный ответ про футбол ≠ «любит футбол». Gameplay — для калибровки сложности, а не перестройки профиля.
- **Skip:** вопрос исключён, family не идёт следом, quality signal. Skip одного вопроса ≠ комната не любит тему.
- **Late join:** профиль обновляется, показанные вопросы не меняются.
- **Player leaves:** временно отключившийся остаётся в профиле; ушедший (LEFT) или долго отсутствующий — вес постепенно снижается.
- **Play Again:** used_question_ids / fact_ids / family_ids сохраняются на уровне Room; onboarding можно оставить («Оставить мои настройки») или пройти заново; Group Profile строится заново.

## 15. Mixed-age Fairness

Комната 5 × 35–44 + 1 × 16: нельзя распределять поколенческие вопросы 5:1. Если поколение представлено хотя бы одним игроком — минимум 10–15 % generation-relevant opportunities: несколько generation-specific, несколько bridge, несколько global / current.

## 16. Metrics

**Hero Moment proxy:** affinity игрока A высокая + A ответил верно + < 50 % комнаты верно. Сильный: только A верно.

**Why Do I Remember This proxy:** эффект WHY_DO_I_REMEMBER_THIS + хороший correct rate + высокий Great rate + низкий skip.

**Composition quality (на Room):** topic diversity, player coverage (доля игроков с ≥ 1 high-affinity вопросом), hero opportunity coverage, difficulty balance vs target, dignity balance vs распределение, средние feedback / skip.

## 17. Guardrails

Никогда:

- 4+ почти одинаковые темы подряд;
- hero-вопросы только одного игрока;
- квиз полностью из onboarding selections или полностью из wildcards;
- большой speed / reading bias;
- explicit для minors;
- повтор fact_id;
- unverified media, retired, DRAFT в live;
- переведённый LOCAL-вопрос.

## 18. Privacy

Engine знает individual affinities; player-facing output — нет. Selection metadata (`hero_candidate_player_id`, scores) — только backend / debug; после закрытия Room агрегируется без player identity. Персонализация должна ощущаться магией, а не surveillance.

## 19. Evolution

Сначала rule-based ranking: объяснимо, тестируемо, меняется вручную. После накопления данных — модели вида `P(positive feedback | room profile)` или `P(play again | session composition)`. Начинать с ML не нужно.

## 20. Central Hypothesis

Engine успешен, если после 25 вопросов игроки чувствуют: тут было что-то для всех; я не понимал, откуда другие это знают; один вопрос я взял совершенно один; я вспомнил абсолютную ерунду из 2003 года; я бы сыграл ещё.
