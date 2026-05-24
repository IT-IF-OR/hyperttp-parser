import type { ConversionMeta, ResponseType, SourceType } from "@hyperttp/core";
import { ParsedResponse, ResponseConverterOptions } from "../types/response.js";

const EMPTY_BUFFER = Buffer.alloc(0);

function normalizeContentType(ct?: string): string | undefined {
  if (!ct) return undefined;
  const semiIdx = ct.indexOf(";");
  return (semiIdx === -1 ? ct : ct.slice(0, semiIdx)).trim().toLowerCase();
}

function isWhitespaceByte(byte: number): boolean {
  return byte === 32 || byte === 9 || byte === 10 || byte === 13;
}

export class ResponseConverter {
  private _xmlParser: any | null = null;
  private _xmlBuilder: any | null = null;
  private _cheerio: any | null = null;

  constructor(private readonly options: ResponseConverterOptions = {}) {}

  private async getXmlParser(): Promise<any> {
    if (!this._xmlParser) {
      const mod = await import("fast-xml-parser");
      const XMLParserCtor = (mod as any).XMLParser;
      this._xmlParser = new XMLParserCtor({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        parseTagValue: false,
        parseAttributeValue: false,
        trimValues: true,
      });
    }
    return this._xmlParser;
  }

  private async getXmlBuilder(): Promise<any> {
    if (!this._xmlBuilder) {
      const mod = await import("fast-xml-builder");
      const XMLBuilderCtor =
        (mod as any).default ?? (mod as any).XMLBuilder ?? mod;
      this._xmlBuilder = new XMLBuilderCtor({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        format: false,
      });
    }
    return this._xmlBuilder;
  }

  private async getCheerio(): Promise<any> {
    if (!this._cheerio) {
      const mod = await import("cheerio");
      this._cheerio = (mod as any).default ?? mod;
    }
    return this._cheerio;
  }

  async convertAsync(
    body: any,
    targetType: ResponseType,
    meta: ConversionMeta = {},
  ): Promise<ParsedResponse> {
    const buffer = await this.readBody(body);
    return Promise.resolve(this.convertFromBuffer(buffer, targetType, meta));
  }

  async readBody(body: any): Promise<Buffer> {
    if (!body) return EMPTY_BUFFER;
    if (Buffer.isBuffer(body)) return body;
    if (typeof body === "string") return Buffer.from(body, "utf-8");

    if (typeof body.arrayBuffer === "function") {
      const ab = await body.arrayBuffer();
      return Buffer.from(ab);
    }

    if (Array.isArray(body)) {
      if (body.length === 0) return EMPTY_BUFFER;
      if (body.length === 1) {
        const chunk = body[0];
        return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      }

      const buffers = new Array<Buffer>(body.length);
      let total = 0;

      for (let i = 0; i < body.length; i++) {
        const chunk = body[i];
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        buffers[i] = buf;
        total += buf.length;
      }

      return Buffer.concat(buffers, total);
    }

    const max = this.options.maxBodySize ?? 0;

    if (typeof body.on === "function") {
      return new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let received = 0;

        const cleanup = () => {
          body.off("data", onData);
          body.off("end", onEnd);
          body.off("error", onError);
        };

        const onData = (chunk: any) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          received += buf.length;

          if (max > 0 && received > max) {
            cleanup();
            if (typeof body.destroy === "function") body.destroy();
            reject(new Error(`Response size limit exceeded (${max} bytes)`));
            return;
          }

          chunks.push(buf);
        };

        const onEnd = () => {
          cleanup();

          if (chunks.length === 0) {
            resolve(EMPTY_BUFFER);
            return;
          }

          if (chunks.length === 1) {
            resolve(chunks[0]);
            return;
          }

          resolve(Buffer.concat(chunks, received));
        };

        const onError = (err: any) => {
          cleanup();
          reject(err);
        };

        body.on("data", onData);
        body.on("end", onEnd);
        body.on("error", onError);
      });
    }

    const chunks: Buffer[] = [];
    let received = 0;

    for await (const chunk of body) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += buf.length;

      if (max > 0 && received > max) {
        if (typeof body.destroy === "function") body.destroy();
        throw new Error(`Response size limit exceeded (${max} bytes)`);
      }

      chunks.push(buf);
    }

    if (chunks.length === 0) return EMPTY_BUFFER;
    if (chunks.length === 1) return chunks[0];

    return Buffer.concat(chunks, received);
  }

  detectSourceType(
    contentType?: string,
    text?: string,
    url?: string,
  ): SourceType {
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

    if (url) {
      const lower = url.toLowerCase();
      if (lower.endsWith(".json")) return "json";
      if (lower.endsWith(".xml")) return "xml";
      if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
    }

    if (!text || text.length === 0) return "text";

    let firstChar = "";
    const scanLimit = Math.min(text.length, 128);

    for (let i = 0; i < scanLimit; i++) {
      const c = text.charCodeAt(i);
      if (!isWhitespaceByte(c)) {
        firstChar = text[i];
        break;
      }
    }

    if (firstChar === "{" || firstChar === "[") return "json";
    if (firstChar === "<") return "xml";
    return "text";
  }

  private detectSourceTypeFromBuffer(body: Buffer, url?: string): SourceType {
    if (body.length === 0) return "text";

    const limit = Math.min(body.length, 256);
    let firstIdx = 0;

    while (firstIdx < limit && isWhitespaceByte(body[firstIdx])) {
      firstIdx++;
    }

    if (firstIdx >= limit) return "text";

    const first = body[firstIdx];

    if (first === 123 || first === 91) return "json";

    if (first === 60) {
      const sample = body
        .subarray(firstIdx, Math.min(body.length, firstIdx + 64))
        .toString("utf8")
        .toLowerCase();

      if (
        sample.startsWith("<!doctype html") ||
        sample.startsWith("<html") ||
        sample.includes("<html")
      ) {
        return "html";
      }

      return "xml";
    }

    if (url) {
      const lower = url.toLowerCase();
      if (lower.endsWith(".json")) return "json";
      if (lower.endsWith(".xml")) return "xml";
      if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
    }

    return "text";
  }

  convertFromBuffer(
    body: Buffer,
    targetType: ResponseType,
    meta: ConversionMeta = {},
  ): ParsedResponse | Promise<ParsedResponse> {
    if (targetType === "buffer") return body;

    const charset = (this.options.charset ?? "utf-8") as BufferEncoding;
    const contentType = meta.contentType;
    const url = meta.url;

    let sourceType = this.detectSourceType(contentType, undefined, url);
    let textCache: string | null = null;

    const getText = () => {
      if (textCache === null) {
        textCache = body.toString(charset);
      }
      return textCache;
    };

    if (sourceType === "text" && body.length > 0) {
      sourceType = this.detectSourceTypeFromBuffer(body, url);
    }

    switch (targetType) {
      case "text":
        return getText();

      case "json": {
        const text = getText();
        if (!text) return null;
        return this.toJson(text, sourceType, url);
      }

      case "xml": {
        const text = getText();
        if (!text) return "";
        return this.toXml(text, sourceType);
      }

      case "html": {
        const text = getText();
        if (!text) return null;
        return this.toHtml(text, sourceType);
      }

      case "auto":
      default:
        return this.toAuto(sourceType, body, getText, url);
    }
  }

  private toAuto(
    sourceType: SourceType,
    rawBody: Buffer,
    getText: () => string,
    url?: string,
  ): ParsedResponse | Promise<ParsedResponse> {
    if (sourceType === "buffer") return rawBody;

    if (sourceType === "json") {
      const text = getText();
      return text ? this.safeJsonParse(text) : null;
    }

    if (sourceType === "xml") {
      const text = getText();
      return text ? this.getXmlParser().then((p) => p.parse(text)) : null;
    }

    if (sourceType === "html") {
      const text = getText();
      return text ? this.htmlToJson(text) : null;
    }

    const text = getText();
    if (!text) return null;

    if (url) {
      const lower = url.toLowerCase();
      if (lower.endsWith(".json")) return this.safeJsonParse(text);
      if (lower.endsWith(".xml"))
        return this.getXmlParser().then((p) => p.parse(text));
      if (lower.endsWith(".html") || lower.endsWith(".htm")) {
        return this.htmlToJson(text);
      }
    }

    let firstChar = "";
    const scanLimit = Math.min(text.length, 100);

    for (let i = 0; i < scanLimit; i++) {
      const c = text.charCodeAt(i);
      if (!isWhitespaceByte(c)) {
        firstChar = text[i];
        break;
      }
    }

    if (firstChar === "{" || firstChar === "[") {
      return this.safeJsonParse(text);
    }

    if (firstChar === "<") {
      const sample = text.slice(0, 64).toLowerCase();
      if (sample.startsWith("<!doctype html") || sample.startsWith("<html")) {
        return this.htmlToJson(text);
      }
      return this.getXmlParser().then((p) => p.parse(text));
    }

    return text;
  }

  private toJson(
    text: string,
    sourceType: SourceType,
    url?: string,
  ): ParsedResponse | Promise<ParsedResponse> {
    if (!text) return null;
    if (sourceType === "json") return this.safeJsonParse(text);
    if (sourceType === "xml")
      return this.getXmlParser().then((p) => p.parse(text));
    if (sourceType === "html") return this.htmlToJson(text);

    let firstChar = "";
    let firstIdx = 0;
    const scanLimit = Math.min(text.length, 256);

    for (let i = 0; i < scanLimit; i++) {
      const c = text.charCodeAt(i);
      if (!isWhitespaceByte(c)) {
        firstChar = text[i];
        firstIdx = i;
        break;
      }
    }

    if (firstChar === "{" || firstChar === "[") {
      const parsed = this.safeJsonParse(text);
      return this.normalizeResponseShape(parsed, url);
    }

    if (firstChar === "<") {
      const sample = text.slice(firstIdx, firstIdx + 64).toLowerCase();
      if (sample.includes("<html") || sample.includes("<!doctype")) {
        return this.htmlToJson(text);
      }
      return this.getXmlParser().then((p) => p.parse(text));
    }

    return { data: text };
  }

  private toXml(
    text: string,
    sourceType: SourceType,
  ): string | Promise<string> {
    if (!text) return "";
    if (sourceType === "xml") return text;

    if (sourceType === "json") {
      return this.getXmlBuilder().then((b) =>
        b.build(this.safeJsonParse(text)),
      );
    }

    if (sourceType === "html") {
      return this.getXmlBuilder().then((b) => b.build(this.htmlToJson(text)));
    }

    return `<root>${this.escapeXml(text)}</root>`;
  }

  private toHtml(
    text: string,
    sourceType: SourceType,
  ): ParsedResponse | Promise<ParsedResponse> {
    if (!text) return null;
    if (sourceType === "html") return this.htmlToJson(text);
    if (sourceType === "json") return { html: this.safeJsonParse(text) };
    if (sourceType === "xml") {
      return this.getXmlParser().then((p) => ({ xml: p.parse(text) }));
    }
    return this.htmlToJson(text);
  }

  private htmlToJson(html: string): ParsedResponse | Promise<ParsedResponse> {
    if (this.options.parseHTML === false) return html;

    return this.getCheerio().then((cheerio) => {
      const $ = cheerio.load(html);

      if (this.options.htmlMode === "simple") {
        return {
          title: $("title").text(),
          text: $("body").text().trim(),
        };
      }

      const result: Record<string, any> = {
        title: $("title").text() || undefined,
        meta: {},
        body: { text: $("body").text().trim() },
      };

      $("meta").each((_: any, el: any) => {
        const $el = $(el);
        const name =
          $el.attr("name") || $el.attr("property") || $el.attr("charset");
        const content = $el.attr("content") || $el.attr("value") || "";
        if (name) result.meta[name] = content;
      });

      $("body")
        .children()
        .each((_: any, el: { tagName: string }) => {
          const tag = el.tagName?.toLowerCase();
          if (!tag) return;
          const text = $(el).text().trim();
          if (!text) return;
          if (!result.body[tag]) result.body[tag] = [];
          result.body[tag].push(text);
        });

      return result;
    });
  }

  private safeJsonParse(text: string): any {
    try {
      return JSON.parse(text);
    } catch {
      return { data: text };
    }
  }

  private normalizeResponseShape(value: any, url?: string): any {
    if (!value || Array.isArray(value) || typeof value !== "object") {
      return value;
    }

    if (url && url.includes("/download-info")) {
      if (value.downloadInfo === undefined) {
        const candidate = value.result ?? value.data ?? value.response ?? value;
        if (candidate && typeof candidate === "object") {
          if (Array.isArray(candidate)) {
            value.downloadInfo = candidate;
          } else {
            for (const key in candidate) {
              value[key] = candidate[key];
            }
            value.downloadInfo = candidate.downloadInfo ?? candidate;
          }
          return value;
        }
      }
    }

    const wrapper = value.result ?? value.data ?? value.response;
    if (wrapper && typeof wrapper === "object" && !Array.isArray(wrapper)) {
      const merged: Record<string, any> = {};
      for (const key in value) merged[key] = value[key];
      for (const key in wrapper) merged[key] = wrapper[key];
      return merged;
    }

    return value;
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  toBuffer(input: any): Buffer {
    if (Buffer.isBuffer(input)) return input;
    if (typeof input === "string") return Buffer.from(input, "utf-8");
    return Buffer.from(JSON.stringify(input), "utf-8");
  }
}
