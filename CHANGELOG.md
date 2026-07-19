# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [1.2.0] - 2026-07-19

### Changed

- **Replaced `cheerio` with `node-html-parser`** for HTML parsing — lighter dependency, no DOM emulation overhead.
- `htmlToJson()` rewritten to use `querySelector` / `querySelectorAll` / `getAttribute` API instead of cheerio's jQuery-like interface.
- Lazy loader renamed from `getCheerio()` to `getHtmlParser()`.

### Fixed

- **Critical bug in `slow()` buffer path for Bun**: `decoder.decode(TextEncoder.encode(text))` was encoding then immediately decoding, returning a `string` instead of `Uint8Array`. Now correctly returns `new TextEncoder().encode(text)`.

### Improved

- **Bun-native `ReadableStream` reading**: `readReadableStream()` now uses `new Response(stream).arrayBuffer()` on Bun, delegating to the C++ fast path instead of manual JS chunk iteration.
- **Unified conversion pipeline**: Merged `fastBun` / `fastNode` into a single `fast()` method with runtime branching only where it matters (buffer output). Removed `convertBun` / `convertNode` — `convertBody()` is now a clean `tryNative → fast → slow` chain.
- **Centralized `bodyToBytes()` extractor**: Single source of truth for resolving any body type (Uint8Array, ArrayBuffer, Buffer, Blob, ReadableStream, AsyncIterable, Node stream) to `Uint8Array`. Eliminates duplicated type-checking cascades across `fast`, `toText`, and `resolveJsonBody`.
- **DRY refactoring**: Extracted `bytesToText()`, `tryParseJson()`, and `resolveJsonBody()` helpers. JSON parsing deduplicated from ~80 lines per runtime to a single call.
- **Typed parser fields**: `_xmlParser` and `_htmlParser` fields now carry minimal type signatures instead of `any`.
- Updated `README.md` to reflect the new HTML parser dependency.

## [1.1.9]

- Version bump.

## [1.1.8]

- Previous release (last tagged version before refactor).

## [1.0.0] - Initial

- Initial public release.
- Automatic response type detection (`auto`) from `Content-Type` and URL extension.
- Runtime-aware conversion pipeline: `fastBun` / `fastNode` with lazy dynamic imports for heavy parsers.
- Support for `json`, `text`, `buffer`, `html`, `xml`, `stream` response types.
- HTML-to-JSON extraction (simple and full modes).
- XML parsing via `fast-xml-parser`.
- Stream cleanup on error responses.
- Performance timing via `trackTimings` option.
