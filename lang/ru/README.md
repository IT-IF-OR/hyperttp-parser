# @hyperttp/parser

> [English](https://github.com/IT-IF-OR/hyperttp-parser) | Русский

Официальный плагин преобразования ответов для Hyperttp.

## Возможности

- Автоматически определяет JSON, HTML, XML, текстовые и бинарные ответы.
- Поддерживает типы `auto`, `json`, `text`, `html`, `xml`, `buffer` и `stream`.
- Явно заданный тип ответа имеет приоритет над `Content-Type`.
- Поддерживает protocol-neutral callbacks для извлечения данных и определения типа ответа.
- Уже преобразованные значения передаются без повторной обработки.
- При изменении `data` возвращает новый `UniversalResponse`, не изменяя исходный объект.

## Установка

```bash
npm install @hyperttp/parser
# или
bun add @hyperttp/parser
```

## Использование

Пакет `hyperttp` регистрирует parser автоматически:

```ts
import { HyperClient } from "hyperttp";

const client = new HyperClient({
  responseConverter: {
    parseHTML: true,
    htmlMode: "full",
  },
});

const user = await client.get<{ id: number }>(
  "https://api.example.com/users/1",
  "json",
);
```

Отключить встроенный parser можно через `responseConverter: false`:

```ts
const client = new HyperClient({
  responseConverter: false,
});
```

При прямом использовании `@hyperttp/core` зарегистрируйте plugin явно:

```ts
import { HyperCore } from "@hyperttp/core";
import { withParser } from "@hyperttp/parser";

const core = new HyperCore();
core.use(withParser({ htmlMode: "full" }));
```

Один только импорт `@hyperttp/parser` не регистрирует plugin.

## Типы ответа

| Тип | Результат |
| --- | --- |
| `auto` | Определение по `Content-Type` или расширению URL |
| `json` | JavaScript-значение после JSON-разбора |
| `text` | Строка |
| `html` | Объект HTML или исходная строка при `parseHTML: false` |
| `xml` | Результат `fast-xml-parser` |
| `buffer` | `Buffer` в Node.js или `Uint8Array` в Bun |
| `stream` | Передача без преобразования |

## Настройка

`withParser(options?)` поддерживает `charset`, `parseHTML`, `htmlMode`, `xmlParserOptions`,
`shouldParse`, `getData`/`bodyExtractor`, `getResponseType`/`detectResponseType` и
`isEmptyResponse`. Callbacks могут быть синхронными или асинхронными и получают response,
request и request context.

Для REST ответы `HEAD` по умолчанию пропускаются, а статусы `204`, `205` и `304`
возвращаются с `data: null`. Для других протоколов поведение задаётся callbacks.

> `maxBodySize` и `parseErrors` зарезервированы в v2.0.0 и пока не применяются при преобразовании.

## Лицензия

MIT © dirold2
