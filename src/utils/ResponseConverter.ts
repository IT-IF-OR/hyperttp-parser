import type { ConversionMeta, ResponseType, IHyperCore } from "@hyperttp/types";
import type {
  ParsedResponse,
  ResponseConverterOptions,
} from "../types/response.js";

const EMPTY_BUFFER = Buffer.alloc(0);

type InternalTargetType = ResponseType | "html";

interface XmlParserInstance {
  parse(text: string): unknown;
}

interface NodeStreamLike {
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
  destroy?(): void;
}

interface Destroyable {
  destroy(): void;
}

interface CheerioElement {
  name?: string;
  tagName?: string;
  attribs?: Record<string, string>;
}

interface CheerioWrapper {
  text(): string;
  children(): CheerioWrapper;
  each(callback: (index: number, element: unknown) => void): CheerioWrapper;
}

interface CheerioAPI {
  load(html: string): (selector: string | unknown) => CheerioWrapper;
}

function extractRaw<T>(target: T | { raw?: T }): T {
  if (target && typeof target === "object") {
    const raw = (target as Record<string, unknown>).raw;
    if (raw !== undefined) return raw as T;
  }
  return target as T;
}

interface TransportResponseLike {
  body: unknown;
  headers?: Record<string, string | string[]>;
  status?: number;
  url?: string;
  buffer?(): Promise<Buffer>;
}

function normalizeContentType(ct?: string): string | undefined {
  if (!ct) return undefined;
  const semi = ct.indexOf(";");
  const str = semi === -1 ? ct : ct.slice(0, semi);
  return str.trim().toLowerCase();
}

let cachedNodeBufferFn: ((stream: any) => Promise<Buffer>) | null = null;
let triedLoadingConsumers = false;

export class ResponseConverter {
  private _xmlParser: XmlParserInstance | null = null;
  private _cheerio: CheerioAPI | null = null;

  constructor(
    protected readonly core: IHyperCore,
    protected readonly options: ResponseConverterOptions = {},
  ) {}

  public async convertAsync(
    target: unknown,
    targetType: ResponseType,
    meta: ConversionMeta = {},
  ): Promise<ParsedResponse> {
    if (target == null) return null;

    const source = extractRaw(target);

    if (this.isTransportResponseLike(source)) {
      meta.url ??= source.url;

      if (targetType === "stream") {
        return source.body as ParsedResponse;
      }

      const body = source.body;
      if (!body) return null;

      const buffer = await this.readBody(body);

      const finalType =
        targetType === "auto"
          ? this.detectSourceType(meta.contentType, meta.url)
          : targetType;

      return this.convertFromBuffer(buffer, finalType, meta);
    }

    const buffer = await this.readBody(source);
    return this.convertFromBuffer(buffer, targetType, meta);
  }

  public async dumpAsync(target: unknown): Promise<void> {
    if (target == null) return;
    const source = extractRaw(target);

    if (typeof source === "object" && source !== null) {
      if ("dump" in source && typeof (source as any).dump === "function") {
        await (source as any).dump();
        return;
      }

      if (
        typeof globalThis.ReadableStream !== "undefined" &&
        source instanceof globalThis.ReadableStream
      ) {
        if (!source.locked) await source.cancel();
        return;
      }

      if (
        "destroy" in source &&
        typeof (source as Destroyable).destroy === "function"
      ) {
        (source as Destroyable).destroy();
        return;
      }
    }

    try {
      if (this.isAsyncIterable(source)) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of source) {
          //
        }
      }
    } catch {
      //
    }
  }

  public async readBody(body: unknown): Promise<Buffer> {
    if (body == null) return EMPTY_BUFFER;
    if (Buffer.isBuffer(body)) return body;
    if (typeof body === "string") return Buffer.from(body, "utf-8");
    if (body instanceof ArrayBuffer) return Buffer.from(body);

    if (ArrayBuffer.isView(body)) {
      return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    }

    if (typeof Blob !== "undefined" && body instanceof Blob) {
      const ab = await body.arrayBuffer();
      this.checkSizeLimit(ab.byteLength, this.options.maxBodySize ?? 0);
      return Buffer.from(ab);
    }

    const maxBytes = this.options.maxBodySize ?? 0;
    const isBun = typeof (globalThis as any).Bun !== "undefined";

    if (
      typeof globalThis.ReadableStream !== "undefined" &&
      body instanceof globalThis.ReadableStream
    ) {
      if (maxBytes === 0) {
        if (isBun) {
          return Buffer.from(
            await (globalThis as any).Bun.readableStreamToBytes(body),
          );
        }

        if (!cachedNodeBufferFn && !triedLoadingConsumers) {
          triedLoadingConsumers = true;
          try {
            const { buffer } = await import("node:stream/consumers");
            cachedNodeBufferFn = buffer;
          } catch {
            //
          }
        }

        if (cachedNodeBufferFn) {
          return await cachedNodeBufferFn(body);
        }
      }

      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (maxBytes > 0 && received > maxBytes) {
            throw new Error(`Response size limit exceeded (${maxBytes} bytes)`);
          }
          chunks.push(value);
        }
        if (received === 0) return EMPTY_BUFFER;

        if (chunks.length === 1) {
          const first = chunks[0];
          return Buffer.isBuffer(first) ? first : Buffer.from(first);
        }
        return Buffer.concat(chunks, received);
      } finally {
        reader.releaseLock();
      }
    }

    if (this.hasArrayBufferMethod(body)) {
      const ab = await body.arrayBuffer();
      this.checkSizeLimit(ab.byteLength, maxBytes);
      return Buffer.from(ab);
    }

    if (Array.isArray(body)) {
      if (body.length === 0) return EMPTY_BUFFER;
      let total = 0;
      const chunks = (body as unknown[]).map((chunk) => {
        if (Buffer.isBuffer(chunk)) {
          total += chunk.length;
          return chunk;
        }
        if (chunk instanceof Uint8Array) {
          total += chunk.byteLength;
          return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        }
        const str = typeof chunk === "string" ? chunk : String(chunk);
        const len = Buffer.byteLength(str);
        total += len;
        return Buffer.from(str, "utf-8");
      });
      return Buffer.concat(chunks, total);
    }

    if (this.isNodeStream(body)) {
      return this.readNodeStream(body, maxBytes);
    }

    if (this.isAsyncIterable(body)) {
      return this.readAsyncIterable(body, maxBytes);
    }

    return Buffer.from(JSON.stringify(body), "utf-8");
  }

  public convertFromBuffer(
    body: Buffer,
    targetType: ResponseType,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _meta: ConversionMeta = {},
  ): ParsedResponse | Promise<ParsedResponse> {
    if (targetType === "buffer") return body;

    let finalType: ResponseType = targetType;
    if (finalType === "auto") {
      finalType = this.guessTypeFromBuffer(body) as ResponseType;
    }

    if (finalType === "buffer") return body;

    const text = body.toString(this.options.charset ?? "utf-8");

    switch (finalType) {
      case "json":
        return this.safeJsonParse(text);

      case "text":
        return text;

      case "html":
        return this.htmlToJson(text);

      case "xml":
        return this.getXmlParser().then(
          (parser) => parser.parse(text) as ParsedResponse,
        );

      default:
        return text;
    }
  }

  public detectSourceType(
    contentType?: string,
    url?: string,
  ): InternalTargetType {
    if (contentType) {
      const len = contentType.length;
      if (len >= 16 && contentType.startsWith("application/json"))
        return "json";
      if (len >= 9 && contentType.startsWith("text/html")) return "html";
      if (
        len >= 15 &&
        (contentType.startsWith("application/xml") ||
          contentType.startsWith("text/xml"))
      )
        return "xml";

      const ct = normalizeContentType(contentType);
      if (ct) {
        if (ct === "application/json" || ct.endsWith("+json")) return "json";
        if (ct === "text/html") return "html";
        if (ct === "application/xml" || ct === "text/xml") return "xml";
        if (
          ct.startsWith("image/") ||
          ct.startsWith("audio/") ||
          ct.startsWith("video/") ||
          ct === "application/octet-stream"
        ) {
          return "buffer";
        }
      }
    }

    if (url) {
      const idx = url.lastIndexOf(".");
      if (idx !== -1) {
        const ext = url.slice(idx).toLowerCase();
        if (ext === ".json") return "json";
        if (ext === ".xml") return "xml";
        if (ext === ".html" || ext === ".htm") return "html";
      }
    }

    return "auto";
  }

  private guessTypeFromBuffer(body: Buffer): InternalTargetType {
    const len = body.length;
    if (len === 0) return "text";

    let start = 0;
    while (start < len) {
      const ch = body[start];
      // Fast Whitespace Skip (JIT-optimized)
      if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
        start++;
      } else {
        break;
      }
    }

    if (start >= len) return "text";
    const firstByte = body[start];

    // '{' '[' -> JSON
    if (firstByte === 123 || firstByte === 91) {
      return "json";
    }

    // '<'
    if (firstByte === 60) {
      if (len - start >= 5) {
        const slice = body.toString("utf-8", start, start + 5).toLowerCase();
        if (slice === "<html" || slice === "<!doc") return "html";
      }
      return "xml";
    }

    return "text";
  }

  private async htmlToJson(html: string): Promise<ParsedResponse> {
    if (this.options.parseHTML === false) return html;

    const cheerio = await this.getCheerio();
    const $ = cheerio.load(html);

    if (this.options.htmlMode === "simple") {
      return {
        title: $("title").text(),
        text: $("body").text().trim(),
      };
    }

    const result = {
      title: $("title").text() || undefined,
      meta: {} as Record<string, string>,
      body: { text: $("body").text().trim() } as Record<string, unknown>,
    };

    $("meta").each((_, el) => {
      const element = el as CheerioElement;
      const attr = element.attribs;
      if (!attr) return;
      const name = attr.name || attr.property || attr.charset;
      const content = attr.content || attr.value || "";
      if (name) result.meta[name] = content;
    });

    $("body")
      .children()
      .each((_, el) => {
        const element = el as CheerioElement;
        const tag = element.name || element.tagName;
        if (!tag) return;
        const text = $(element).text().trim();
        if (!text) return;

        const bodyTarget = result.body as Record<string, string[]>;
        (bodyTarget[tag] ??= []).push(text);
      });

    return result as ParsedResponse;
  }

  private isTransportResponseLike(obj: unknown): obj is TransportResponseLike {
    return (
      obj != null &&
      typeof obj === "object" &&
      "body" in obj &&
      ("headers" in obj || "status" in obj || "url" in obj)
    );
  }

  private safeJsonParse(text: string): ParsedResponse {
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch {
      const firstBrace = text.indexOf("{");
      const firstBracket = text.indexOf("[");
      const start =
        firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)
          ? firstBrace
          : firstBracket;

      if (start !== -1) {
        const lastBrace = text.lastIndexOf("}");
        const lastBracket = text.lastIndexOf("]");
        const end = lastBrace > lastBracket ? lastBrace : lastBracket;

        if (end > start) {
          try {
            return JSON.parse(text.slice(start, end + 1));
          } catch {
            //
          }
        }
      }

      return { data: text } as ParsedResponse;
    }
  }

  private checkSizeLimit(size: number, max: number): void {
    if (max > 0 && size > max) {
      throw new Error(`Response size limit exceeded (${max} bytes)`);
    }
  }

  private isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
    return (
      value != null &&
      typeof value === "object" &&
      Symbol.asyncIterator in value
    );
  }

  private hasArrayBufferMethod(
    value: unknown,
  ): value is { arrayBuffer(): Promise<ArrayBuffer> } {
    return (
      value != null &&
      typeof value === "object" &&
      "arrayBuffer" in value &&
      typeof (value as Record<string, unknown>).arrayBuffer === "function"
    );
  }

  private isNodeStream(value: unknown): value is NodeStreamLike {
    return (
      value != null &&
      typeof value === "object" &&
      "on" in value &&
      typeof (value as Record<string, unknown>).on === "function"
    );
  }

  private readNodeStream(stream: any, max: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      let received = 0;

      const onData = (chunk: any) => {
        let buf: Uint8Array;
        if (chunk instanceof Uint8Array) {
          buf = chunk;
        } else if (typeof chunk === "string") {
          buf = Buffer.from(chunk, "utf-8");
        } else if (chunk && typeof chunk === "object") {
          buf = Buffer.from(JSON.stringify(chunk), "utf-8");
        } else {
          buf = Buffer.from(String(chunk), "utf-8");
        }

        received += buf.byteLength;

        if (max > 0 && received > max) {
          cleanup();
          if (typeof stream.destroy === "function") {
            stream.destroy();
          }
          reject(new Error(`Response size limit exceeded (${max} bytes)`));
          return;
        }
        chunks.push(buf);
      };

      const onEnd = () => {
        cleanup();
        if (received === 0) {
          resolve(EMPTY_BUFFER);
          return;
        }

        if (chunks.length === 1) {
          const first = chunks[0];
          resolve(Buffer.isBuffer(first) ? first : Buffer.from(first));
          return;
        }
        resolve(Buffer.concat(chunks, received));
      };

      const onError = (err: any) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        stream.off("data", onData);
        stream.off("end", onEnd);
        stream.off("error", onError);
      };

      stream.on("data", onData);
      stream.on("end", onEnd);
      stream.on("error", onError);
    });
  }

  private async readAsyncIterable(
    iterable: AsyncIterable<unknown>,
    max: number,
  ): Promise<Buffer> {
    const chunks: Uint8Array[] = [];
    let received = 0;

    for await (const chunk of iterable) {
      let buf: Uint8Array;
      if (chunk instanceof Uint8Array) {
        buf = chunk;
      } else if (typeof chunk === "string") {
        buf = Buffer.from(chunk, "utf-8");
      } else if (chunk && typeof chunk === "object") {
        buf = Buffer.from(JSON.stringify(chunk), "utf-8");
      } else {
        buf = Buffer.from(String(chunk), "utf-8");
      }

      received += buf.byteLength;

      if (max > 0 && received > max) {
        if (
          "destroy" in iterable &&
          typeof (iterable as Destroyable).destroy === "function"
        ) {
          (iterable as Destroyable).destroy();
        }
        throw new Error(`Response size limit exceeded (${max} bytes)`);
      }
      chunks.push(buf);
    }

    if (received === 0) return EMPTY_BUFFER;
    if (chunks.length === 1) {
      const first = chunks[0];
      return Buffer.isBuffer(first) ? first : Buffer.from(first);
    }
    return Buffer.concat(chunks, received);
  }

  private async getXmlParser(): Promise<XmlParserInstance> {
    if (!this._xmlParser) {
      const { XMLParser } = await import("fast-xml-parser");
      this._xmlParser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        parseTagValue: false,
        parseAttributeValue: false,
        trimValues: true,
      });
    }
    return this._xmlParser;
  }

  private async getCheerio(): Promise<CheerioAPI> {
    if (!this._cheerio) {
      const mod = (await import("cheerio")) as unknown as Record<
        string,
        unknown
      >;
      this._cheerio = (mod.default ?? mod) as CheerioAPI;
    }
    return this._cheerio;
  }
}
