# @hyperttp/parser

> [English](https://github.com/IT-IF-OR/hyperttp-parser) | [Русский](https://github.com/IT-IF-OR/hyperttp-parser/tree/main/lang/ru)

Automated response parsing and content conversion plugin for Hyperttp.

## Features

- Detects JSON, HTML, XML, text, and binary responses automatically.
- Supports explicit `auto`, `json`, `text`, `html`, `xml`, `buffer`, and `stream` response types.
- Explicit response types take precedence over `Content-Type`.
- Supports protocol-neutral callbacks for data extraction and response-type detection.
- Passes through values that have already been converted.
- Returns a new `UniversalResponse` when `data` changes instead of mutating the input.

## Installation

```bash
npm install @hyperttp/parser
# or
bun add @hyperttp/parser
```

## Usage

The `hyperttp` package registers the parser automatically:

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

Disable the built-in parser with `responseConverter: false`:

```ts
const client = new HyperClient({
  responseConverter: false,
});
```

When using `@hyperttp/core` directly, register the plugin explicitly:

```ts
import { HyperCore } from "@hyperttp/core";
import { withParser } from "@hyperttp/parser";

const core = new HyperCore();
core.use(withParser({ htmlMode: "full" }));
```

Importing `@hyperttp/parser` alone does not register the plugin.

## Response types

| Type | Result |
| --- | --- |
| `auto` | Detect from `Content-Type` or URL extension |
| `json` | Parsed JavaScript value |
| `text` | String |
| `html` | Parsed HTML or the original string when `parseHTML: false` |
| `xml` | Parsed by `fast-xml-parser` |
| `buffer` | `Buffer` in Node.js or `Uint8Array` in Bun |
| `stream` | Passed through without conversion |

## Configuration

`withParser(options?)` supports `charset`, `parseHTML`, `htmlMode`, `xmlParserOptions`,
`shouldParse`, `getData`/`bodyExtractor`, `getResponseType`/`detectResponseType`, and
`isEmptyResponse`. Callbacks can be synchronous or asynchronous and receive the response,
request, and request context.

For REST, `HEAD` responses are skipped by default, and statuses `204`, `205`, and `304`
are returned with `data: null`. Other protocols can define their own behavior through callbacks.

> `maxBodySize` and `parseErrors` are reserved options in v2.0.0 and are not currently
> applied during conversion.

## License

MIT © dirold2
