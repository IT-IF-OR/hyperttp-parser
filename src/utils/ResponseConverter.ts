import type { ConversionMeta, ResponseType, IHyperCore } from "@hyperttp/types";

import type {
  ParsedResponse,
  ResponseConverterOptions,
} from "../types/response.js";

const EMPTY_BUFFER = Buffer.alloc(0);

type InternalTargetType = ResponseType | "html";

interface CheerioWrapper {
  text(): string;
  attr(name: string): string | undefined;
  children(): CheerioWrapper;
  each(callback: (index: number, element: unknown) => void): CheerioWrapper;
}

interface CheerioAPI {
  load(html: string): (selector: unknown) => CheerioWrapper;
}

interface XmlParserInstance {
  parse(text: string): unknown;
}

interface NodeStreamLike {
  on(event: string, listener: (...args: any[]) => void): void;
  off(event: string, listener: (...args: any[]) => void): void;
  destroy?(): void;
}

type MaybeRawResponse<T = unknown> = {
  raw?: T;
};

function extractRaw<T>(target: T | MaybeRawResponse<T>): T {
  if (target != null && typeof target === "object") {
    const raw = (target as any).raw;
    if (raw !== undefined) {
      return raw;
    }
  }
  return target as T;
}

interface TransportResponseLike {
  text(): Promise<string>;
  json(): Promise<unknown>;
  body: unknown;
  headers: Record<string, string | string[]>;
  url: string;
  dump?(): Promise<void>;
}

function normalizeContentType(ct?: string): string | undefined {
  if (!ct) return undefined;

  const semi = ct.indexOf(";");

  return (semi === -1 ? ct : ct.slice(0, semi)).trim().toLowerCase();
}

export class ResponseConverter {
  private _xmlParser: XmlParserInstance | null = null;
  private _cheerio: CheerioAPI | null = null;

  constructor(
    protected readonly core: IHyperCore,
    protected readonly options: ResponseConverterOptions = {},
  ) {}

  // =========================================================
  // PUBLIC API
  // =========================================================

  public async convertAsync(
    target: unknown,
    targetType: ResponseType,
    meta: ConversionMeta = {},
  ): Promise<ParsedResponse> {
    if (target == null) {
      return null;
    }

    const source = extractRaw(target);

    // =========================================================
    // FAST TRANSPORT PATH
    // =========================================================

    if (this.isTransportResponseLike(source)) {
      const contentType =
        meta.contentType ?? this.extractContentType(source.headers);
      const url = meta.url ?? source.url;

      if (targetType === "stream") {
        return source.body as ParsedResponse;
      }

      const isLiveStream =
        (typeof globalThis.ReadableStream !== "undefined" &&
          source.body instanceof globalThis.ReadableStream) ||
        this.isNodeStream(source.body);

      if (source.body != null && !isLiveStream) {
        if (
          typeof source.body === "object" &&
          !Buffer.isBuffer(source.body) &&
          !(source.body instanceof ArrayBuffer) &&
          !ArrayBuffer.isView(source.body)
        ) {
          if (targetType === "json" || targetType === "auto") {
            return source.body as ParsedResponse;
          }
        }

        const buffer = await this.readBody(source.body);
        return this.convertFromBuffer(buffer, targetType, meta);
      }

      if (targetType === "buffer") {
        return this.readBody(source.body);
      }

      if (targetType === "text") {
        try {
          return await source.text();
        } catch {
          const buffer = await this.readBody(source.body);
          return buffer.toString(this.options.charset ?? "utf-8");
        }
      }

      if (targetType === "json") {
        return this.safeNativeJson(source);
      }

      let detected = this.detectSourceType(contentType, url);

      if (detected === "buffer") {
        return this.readBody(source.body);
      }

      if (detected === "text") {
        try {
          return await source.text();
        } catch {
          const buffer = await this.readBody(source.body);
          return buffer.toString(this.options.charset ?? "utf-8");
        }
      }

      if (detected === "json") {
        return this.safeNativeJson(source);
      }

      let text = "";
      try {
        text = await source.text();
      } catch {
        if (source.body) {
          const buffer = await this.readBody(source.body);
          text = buffer.toString(this.options.charset ?? "utf-8");
        }
      }

      if (!text && source.body) {
        try {
          const buffer = await this.readBody(source.body);
          text = buffer.toString(this.options.charset ?? "utf-8");
        } catch {
          //
        }
      }

      if (!text) {
        return "";
      }

      if (detected === "auto") {
        detected = this.guessTypeFromText(text);
      }

      switch (detected) {
        case "json":
          return this.safeJsonParse(text);

        case "html":
          return this.htmlToJson(text);

        case "xml":
          return (await this.getXmlParser()).parse(text) as ParsedResponse;

        default:
          return text;
      }
    }

    if (Buffer.isBuffer(target)) {
      return targetType === "text"
        ? target.toString(this.options.charset ?? "utf-8")
        : target;
    }

    if (typeof target === "string") {
      if (targetType === "json") {
        return this.safeJsonParse(target);
      }

      return target;
    }

    const body = await this.readBody(target);

    return this.convertFromBuffer(body, targetType, meta);
  }

  private async safeNativeJson(
    source: TransportResponseLike,
  ): Promise<ParsedResponse> {
    try {
      const targetSource =
        typeof (source as any).clone === "function"
          ? (source as any).clone()
          : source;
      const res = await targetSource.json();
      if (res !== undefined && res !== null) {
        return res as ParsedResponse;
      }
      throw new Error("Empty json target");
    } catch {
      try {
        if (source.body) {
          const buffer = await this.readBody(source.body);
          const text = buffer.toString("utf-8");
          return text ? this.safeJsonParse(text) : null;
        }
      } catch {
        //
      }
      return { data: undefined } as ParsedResponse;
    }
  }

  public async dumpAsync(target: unknown): Promise<void> {
    if (target == null) return;

    const source = extractRaw(target);

    if (typeof source === "object" && source !== null) {
      if (
        "dump" in source &&
        typeof (source as Record<string, unknown>).dump === "function"
      ) {
        await (source as { dump(): Promise<void> }).dump();
        return;
      }

      if (
        typeof globalThis.ReadableStream !== "undefined" &&
        source instanceof globalThis.ReadableStream
      ) {
        if (!source.locked) {
          await source.cancel();
        }

        return;
      }

      if (
        "destroy" in source &&
        typeof (source as Record<string, unknown>).destroy === "function"
      ) {
        (source as { destroy(): void }).destroy();
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
    if (body == null) {
      return EMPTY_BUFFER;
    }

    if (Buffer.isBuffer(body)) {
      return body;
    }

    if (typeof body === "string") {
      return Buffer.from(body, "utf-8");
    }

    if (body instanceof ArrayBuffer) {
      return Buffer.from(body);
    }

    if (ArrayBuffer.isView(body)) {
      if (body instanceof DataView) {
        return Buffer.from(
          body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        );
      }

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
      const response = new Response(body as ReadableStream<Uint8Array>);

      const ab = await response.arrayBuffer();

      this.checkSizeLimit(ab.byteLength, maxBytes);

      return Buffer.from(ab);
    }

    if (this.hasArrayBufferMethod(body)) {
      const ab = await body.arrayBuffer();

      this.checkSizeLimit(ab.byteLength, maxBytes);

      return Buffer.from(ab);
    }

    if (Array.isArray(body)) {
      if (body.length === 0) {
        return EMPTY_BUFFER;
      }

      const buffers = body.map((chunk) =>
        Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk as string | Uint8Array),
      );

      const total = buffers.reduce((acc, chunk) => acc + chunk.length, 0);

      return Buffer.concat(buffers, total);
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
    meta: ConversionMeta = {},
  ): ParsedResponse | Promise<ParsedResponse> {
    if (targetType === "buffer") {
      return body;
    }

    const encoding = (this.options.charset ?? "utf-8") as BufferEncoding;

    let textCache: string | null = null;

    const getText = (): string => {
      if (textCache == null) {
        textCache = body.toString(encoding);
      }

      return textCache;
    };

    let detected = this.detectSourceType(meta.contentType, meta.url);

    if (detected === "auto") {
      detected = this.guessTypeFromText(getText());
    }

    const finalType =
      targetType === "auto" ? detected : (targetType as InternalTargetType);

    switch (finalType) {
      case "text":
        return getText();

      case "json":
        return getText() ? this.safeJsonParse(getText()) : null;

      case "xml":
        return getText()
          ? this.getXmlParser().then((p) => p.parse(getText()))
          : "";

      case "html":
        return getText() ? this.htmlToJson(getText()) : null;

      default:
        return getText();
    }
  }

  public detectSourceType(
    contentType?: string,
    url?: string,
  ): InternalTargetType {
    if (contentType) {
      if (
        contentType.startsWith("application/json") ||
        contentType.startsWith("application/json;")
      ) {
        return "json";
      }
      if (
        contentType.startsWith("text/html") ||
        contentType.startsWith("text/html;")
      ) {
        return "html";
      }
      if (
        contentType.startsWith("application/xml") ||
        contentType.startsWith("text/xml")
      ) {
        return "xml";
      }

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
        if (ext === ".html" || ext === ".htm") {
          return "html";
        }
      }
    }

    return "auto";
  }

  private guessTypeFromText(text: string): InternalTargetType {
    if (!text) return "text";

    let i = 0;
    while (i < text.length && text.charCodeAt(i) <= 32) {
      i++;
    }
    if (i >= text.length) return "text";

    const char = text.charAt(i);
    if (char === "{" || char === "[") {
      return "json";
    }

    if (char === "<") {
      const sample = text.slice(i, i + 14).toLowerCase();
      return sample.startsWith("<!doctype html") || sample.startsWith("<html")
        ? "html"
        : "xml";
    }

    return "text";
  }

  private htmlToJson(html: string): ParsedResponse | Promise<ParsedResponse> {
    if (this.options.parseHTML === false) {
      return html;
    }

    return this.getCheerio().then((cheerio) => {
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
        body: {
          text: $("body").text().trim(),
        } as Record<string, unknown>,
      };

      $("meta").each((_, el) => {
        const $el = $(el);

        const name =
          $el.attr("name") || $el.attr("property") || $el.attr("charset");

        const content = $el.attr("content") || $el.attr("value") || "";

        if (name) {
          result.meta[name] = content;
        }
      });

      $("body")
        .children()
        .each((_, el) => {
          const tag = (el as { tagName?: string }).tagName?.toLowerCase();

          if (!tag) return;

          const text = $(el).text().trim();

          if (!text) return;

          if (!result.body[tag]) {
            result.body[tag] = [];
          }

          (result.body[tag] as string[]).push(text);
        });

      return result as ParsedResponse;
    });
  }

  private isTransportResponseLike(obj: unknown): obj is TransportResponseLike {
    return (
      obj != null &&
      typeof obj === "object" &&
      typeof (obj as any).json === "function" &&
      typeof (obj as any).text === "function"
    );
  }

  private extractContentType(
    headers: Record<string, string | string[]>,
  ): string | undefined {
    const raw = headers["content-type"] ?? headers["Content-Type"];

    return Array.isArray(raw) ? raw[0] : raw;
  }

  private safeJsonParse(text: string): ParsedResponse {
    try {
      return JSON.parse(text) as ParsedResponse;
    } catch {
      return {
        data: text,
      } as ParsedResponse;
    }
  }

  private checkSizeLimit(size: number, max: number): void {
    if (max > 0 && size > max) {
      throw new Error(`Response size limit exceeded (${max} bytes)`);
    }
  }

  private isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
    if (value == null || typeof value !== "object") {
      return false;
    }

    const iterator = Reflect.get(value, Symbol.asyncIterator);

    return typeof iterator === "function";
  }

  private hasArrayBufferMethod(value: unknown): value is {
    arrayBuffer(): Promise<ArrayBuffer>;
  } {
    return (
      typeof value === "object" &&
      value !== null &&
      "arrayBuffer" in value &&
      typeof (value as Record<string, unknown>).arrayBuffer === "function"
    );
  }

  private isNodeStream(value: unknown): value is NodeStreamLike {
    return (
      typeof value === "object" &&
      value !== null &&
      "on" in value &&
      typeof (value as Record<string, unknown>).on === "function"
    );
  }

  private async readNodeStream(
    emitter: NodeStreamLike,
    max: number,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let received = 0;

      const cleanup = () => {
        emitter.off("data", onData);
        emitter.off("end", onEnd);
        emitter.off("error", onError);
      };

      const onData = (chunk: unknown) => {
        const buf = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk as string | Uint8Array);

        received += buf.length;

        if (max > 0 && received > max) {
          cleanup();

          if (typeof emitter.destroy === "function") {
            emitter.destroy();
          }

          reject(new Error(`Response size limit exceeded (${max} bytes)`));

          return;
        }

        chunks.push(buf);
      };

      const onEnd = () => {
        cleanup();

        resolve(
          chunks.length === 0
            ? EMPTY_BUFFER
            : chunks.length === 1
              ? chunks[0]!
              : Buffer.concat(chunks, received),
        );
      };

      const onError = (err: unknown) => {
        cleanup();
        reject(err);
      };

      emitter.on("data", onData);
      emitter.on("end", onEnd);
      emitter.on("error", onError);
    });
  }

  private async readAsyncIterable(
    iterable: AsyncIterable<unknown>,
    max: number,
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let received = 0;

    for await (const chunk of iterable) {
      const buf = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as string | Uint8Array);

      received += buf.length;

      if (max > 0 && received > max) {
        if (
          "destroy" in iterable &&
          typeof (iterable as { destroy?: () => void }).destroy === "function"
        ) {
          (iterable as { destroy(): void }).destroy();
        }

        throw new Error(`Response size limit exceeded (${max} bytes)`);
      }

      chunks.push(buf);
    }

    return chunks.length === 0
      ? EMPTY_BUFFER
      : chunks.length === 1
        ? chunks[0]!
        : Buffer.concat(chunks, received);
  }

  private async getXmlParser(): Promise<XmlParserInstance> {
    if (!this._xmlParser) {
      const mod = (await import("fast-xml-parser")) as {
        XMLParser: new (options?: unknown) => XmlParserInstance;
      };

      this._xmlParser = new mod.XMLParser({
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
      const mod = (await import("cheerio")) as Record<string, unknown>;

      this._cheerio = (mod.default ?? mod) as CheerioAPI;
    }

    return this._cheerio;
  }
}
