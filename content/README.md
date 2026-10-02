# Content — банк вопросов

- `taxonomy.yaml` — темы и культурные контексты ([08-topics-mvp](../docs/spec-v0.2/08-topics-mvp.md)).
- `guideline.md` — редакционный гайдлайн; его же получает модель при генерации.
- `families/*.yaml` — вопросы. Файл — набор families, обычно по одной теме.

## Команды

```bash
npm run content:validate          # схема + правила; в CI блокирует merge
npm run content:build             # dist/bank.json (только APPROVED/GOLD) + dist/coverage.md
npm run content:draft -- --topic ru-pop-90s --n 15 --mix 3,6,4,2   # AI-черновики (нужен ANTHROPIC_API_KEY)
npm run content:critique -- content/families/<file>.yaml            # второй проход модели по DRAFT
```

## Как проверять вопрос (шаг 3 пайплайна)

1. Прочитать `statement` факта. Найти источник (обычно статья Википедии из `sources[].name`), открыть, убедиться, что факт верен. Вписать `url`, поставить `verified: true`.
2. Проверить, что **ни один** неправильный вариант нельзя счесть верным.
3. Прочитать `review_notes` (сомнения модели и критика). Исправить вопрос или удалить его. Очистить `review_notes`.
4. Сверить `difficulty`, `dignity`, `culture_specificity` с гайдлайном.
5. Поставить статус и штамп:

```yaml
status: APPROVED          # или FACT_CHECKED, если текст ещё нужно доработать
reviewed: { by: yuliya, at: "2026-10-02" }
```

6. `npm run content:validate` — должно быть 0 ошибок.

Порядок ключей A–D в файле значения не имеет: движок перемешивает варианты при показе.
