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

      return this.convertFromBuffer(buffer, targetType, meta);
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

    if (
      typeof globalThis.ReadableStream !== "undefined" &&
      body instanceof globalThis.ReadableStream
    ) {
      if (maxBytes === 0) {
        if (typeof (globalThis as any).Bun !== "undefined") {
          return Buffer.from(
            await (globalThis as any).Bun.readableStreamToBytes(body),
          );
        }
        if (typeof globalThis.Response !== "undefined") {
          const ab = await new globalThis.Response(body).arrayBuffer();
          return Buffer.from(ab);
        }
      }

      // 🐢 SLOW PATH: Почаночный обход стрима для строгого контроля лимита maxBodySize
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
        return received === 0 ? EMPTY_BUFFER : Buffer.concat(chunks, received);
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
          return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
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

  public async convertFromBuffer(
    body: Buffer,
    targetType: ResponseType,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _meta: ConversionMeta = {},
  ): Promise<ParsedResponse> {
    if (targetType === "buffer") return body;

    const text = body.toString(this.options.charset ?? "utf-8");

    const finalType =
      targetType === "auto" ? this.guessTypeFromText(text) : targetType;

    switch (finalType) {
      case "json":
        return this.safeJsonParse(text);

      case "text":
        return text;

      case "html":
        return this.htmlToJson(text);

      case "xml": {
        const parser = await this.getXmlParser();
        return parser.parse(text) as ParsedResponse;
      }

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

  private guessTypeFromText(text: string): InternalTargetType {
    if (!text) return "text";

    const trimmed = text.trimStart();

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return "json";
    }

    if (trimmed.startsWith("<")) {
      if (trimmed.toLowerCase().includes("<html")) return "html";
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
      const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {
          //
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

  private async readNodeStream(
    emitter: NodeStreamLike,
    max: number,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      let received = 0;

      const onData = (chunk: unknown) => {
        let buf: Uint8Array;
        if (chunk instanceof Uint8Array) {
          buf = chunk;
        } else if (typeof chunk === "string") {
          buf = Buffer.from(chunk, "utf-8");
        } else {
          buf = Buffer.from(String(chunk), "utf-8");
        }

        received += buf.byteLength;

        if (max > 0 && received > max) {
          cleanup();
          if (
            "destroy" in emitter &&
            typeof (emitter as Destroyable).destroy === "function"
          ) {
            (emitter as Destroyable).destroy();
          }
          reject(new Error(`Response size limit exceeded (${max} bytes)`));
          return;
        }
        chunks.push(buf);
      };

      const onEnd = () => {
        cleanup();
        resolve(
          received === 0 ? EMPTY_BUFFER : Buffer.concat(chunks, received),
        );
      };

      const onError = (err: unknown) => {
        cleanup();
        reject(err);
      };

      function cleanup() {
        emitter.off("data", onData);
        emitter.off("end", onEnd);
        emitter.off("error", onError);
      }

      emitter.on("data", onData);
      emitter.on("end", onEnd);
      emitter.on("error", onError);
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

    return chunks.length === 0 ? EMPTY_BUFFER : Buffer.concat(chunks, received);
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
