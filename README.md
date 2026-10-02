# Квиз для своих

Персонализированный квиз для компании 2–8 человек: общий экран + телефоны, без аккаунтов.
Спецификация — [docs/spec-v0.2](docs/spec-v0.2/00-README.md).

## Структура

```
apps/web               React SPA: / (создать), /d/:code (общий экран), /j/:code (телефон)
apps/worker            Cloudflare Worker + RoomDO (Durable Object на комнату)
packages/shared        протокол событий и API, общий для клиента и сервера
packages/content-schema схема и правила банка вопросов
content/               банк вопросов (YAML), taxonomy, гайдлайн
scripts/content        validate / build / draft / critique
scripts/dev/smoke.ts   e2e-проверка комнаты против запущенного worker
```

## Локальный запуск

```bash
npm install
npm run dev        # worker на :8787 и web на :5173
```

Открой http://localhost:5173 на ноутбуке и нажми «Создать игру» — это общий экран.
QR-код указывает на LAN-адрес машины, так что телефоны в той же Wi-Fi-сети подключаются по нему.
Первый вошедший игрок становится ведущим.

Проверки:

```bash
npm run typecheck
npm test
npm run smoke      # нужен запущенный worker
```
