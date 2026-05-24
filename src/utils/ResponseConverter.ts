import { XMLParser } from "fast-xml-parser";
import XMLBuilder from "fast-xml-builder";
import * as cheerio from "cheerio";
import type {
  ConversionMeta,
  ParsedResponse,
  ResponseConverterOptions,
  ResponseType,
  SourceType,
} from "../types/response.js";

function normalizeContentType(ct?: string): string | undefined {
  if (!ct) return undefined;
  const semiIdx = ct.indexOf(";");
  if (semiIdx === -1) {
    return ct.toLowerCase();
  }
  return ct.slice(0, semiIdx).trim().toLowerCase();
}

export class ResponseConverter {
  private readonly xmlParser: XMLParser;
  private readonly xmlBuilder: InstanceType<typeof XMLBuilder>;

  constructor(private readonly options: ResponseConverterOptions = {}) {
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseTagValue: true,
      parseAttributeValue: true,
      trimValues: true,
    });

    this.xmlBuilder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      format: true,
    });
  }

  async readBody(body: any): Promise<Buffer> {
    if (!body) return Buffer.alloc(0);

    if (Buffer.isBuffer(body)) {
      return body;
    }

    if (typeof body.arrayBuffer === "function") {
      const ab = await body.arrayBuffer();
      return Buffer.from(ab, 0, ab.byteLength);
    }

    if (Array.isArray(body)) {
      if (body.length === 0) return Buffer.alloc(0);
      if (body.length === 1) {
        const chunk = body[0];
        return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      }

      const buffers = new Array(body.length);
      for (let i = 0; i < body.length; i++) {
        const chunk = body[i];
        buffers[i] = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      }
      return Buffer.concat(buffers);
    }

    const max = this.options.maxBodySize ?? 0;

    if (typeof body.on === "function") {
      return new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let received = 0;

        const onData = (chunk: any) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          received += buf.length;

          if (max > 0 && received > max) {
            cleanup();
            if (typeof body.destroy === "function") {
              body.destroy();
            }
            reject(new Error(`Response size limit exceeded (${max} bytes)`));
            return;
          }
          chunks.push(buf);
        };

        const onEnd = () => {
          cleanup();
          resolve(Buffer.concat(chunks));
        };

        const onError = (err: any) => {
          cleanup();
          reject(err);
        };

        const cleanup = () => {
          body.off("data", onData);
          body.off("end", onEnd);
          body.off("error", onError);
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
        if (typeof body.destroy === "function") {
          body.destroy();
        }
        throw new Error(`Response size limit exceeded (${max} bytes)`);
      }
      chunks.push(buf);
    }

    return Buffer.concat(chunks);
  }

  detectSourceType(
    contentType?: string,
    text?: string,
    url?: string,
  ): SourceType {
    if (contentType) {
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
      const lower = url.toLowerCase();
      if (lower.endsWith(".json")) return "json";
      if (lower.endsWith(".xml")) return "xml";
      if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
    }

    if (!text || text.length === 0) return "text";

    let firstChar = "";
    let firstIdx = 0;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char !== " " && char !== "\n" && char !== "\r" && char !== "\t") {
        firstChar = char;
        firstIdx = i;
        break;
      }
    }

    if (firstChar === "{" || firstChar === "[") return "json";

    if (firstChar === "<") {
      const sample = text.slice(firstIdx, firstIdx + 15).toLowerCase();
      if (sample.startsWith("<!doctype html") || sample.startsWith("<html")) {
        return "html";
      }
      return "xml";
    }

    return "text";
  }

  convert(
    body: Buffer,
    targetType: ResponseType,
    meta: ConversionMeta = {},
  ): ParsedResponse {
    const charset = (this.options.charset ?? "utf-8") as BufferEncoding;

    const text = body.toString(charset);
    return this.processConversion(body, text, targetType, meta);
  }

  private processConversion(
    body: Buffer,
    text: string,
    targetType: ResponseType,
    meta: ConversionMeta,
  ): ParsedResponse {
    const sourceType = this.detectSourceType(meta.contentType, text, meta.url);

    switch (targetType) {
      case "buffer":
        return body;
      case "text":
        return text;
      case "json":
        return this.toJson(text, sourceType, meta.url);
      case "xml":
        return this.toXml(text, sourceType);
      case "html":
        return this.toHtml(text, sourceType);
      case "auto":
      default:
        return this.toAuto(text, sourceType, meta.url, body);
    }
  }

  private toAuto(
    text: string,
    sourceType: SourceType,
    url?: string,
    rawBody?: Buffer,
  ): ParsedResponse {
    if (sourceType === "buffer") {
      return rawBody ?? Buffer.alloc(0);
    }

    if (!text) return null;

    switch (sourceType) {
      case "json":
        return this.safeJsonParse(text);
      case "xml":
        return this.xmlParser.parse(text);
      case "html":
        return text;
      case "text":
      default:
        if (url) {
          const lower = url.toLowerCase();
          if (
            lower.endsWith(".json") ||
            text.startsWith("{") ||
            text.startsWith("[")
          ) {
            return this.safeJsonParse(text);
          }
        }
        return text;
    }
  }

  private toJson(
    text: string,
    sourceType: SourceType,
    url?: string,
  ): ParsedResponse {
    if (!text) return null;

    if (sourceType === "json") {
      return this.safeJsonParse(text);
    }
    if (sourceType === "xml") {
      return this.xmlParser.parse(text);
    }
    if (sourceType === "html") {
      return this.htmlToJson(text);
    }

    const firstChar = text.trimStart()[0];

    if (firstChar === "{" || firstChar === "[") {
      const parsed = this.safeJsonParse(text);
      return this.normalizeResponseShape(parsed, url);
    }

    if (firstChar === "<") {
      if (
        text.includes("<html") ||
        text.includes("<!DOCTYPE") ||
        text.includes("<!doctype")
      ) {
        return this.htmlToJson(text);
      }
      return this.xmlParser.parse(text);
    }

    return { data: text };
  }

  private toXml(text: string, sourceType: SourceType): string {
    if (!text) return "";

    if (sourceType === "xml") return text;

    if (sourceType === "json") {
      return this.xmlBuilder.build(this.safeJsonParse(text));
    }
    if (sourceType === "html") {
      return this.xmlBuilder.build(this.htmlToJson(text));
    }

    return `<root>${this.escapeXml(text)}</root>`;
  }

  private toHtml(text: string, sourceType: SourceType): ParsedResponse {
    if (!text) return null;
    if (sourceType === "html") return this.htmlToJson(text);

    if (sourceType === "json") {
      return { html: this.safeJsonParse(text) };
    }
    if (sourceType === "xml") {
      return { xml: this.xmlParser.parse(text) };
    }

    return this.htmlToJson(text);
  }

  private htmlToJson(html: string): any {
    if (this.options.parseHTML === false) return html;

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

    $("meta").each((_, el) => {
      const $el = $(el);
      const name =
        $el.attr("name") || $el.attr("property") || $el.attr("charset");
      const content = $el.attr("content") || $el.attr("value") || "";
      if (name) result.meta[name] = content;
    });

    $("body")
      .children()
      .each((_, el) => {
        const tag = el.tagName?.toLowerCase();
        if (!tag) return;

        const text = $(el).text().trim();
        if (!text) return;

        if (!result.body[tag]) result.body[tag] = [];
        result.body[tag].push(text);
      });

    return result;
  }

  private safeJsonParse(text: string): any {
    try {
      return JSON.parse(text);
    } catch {
      return { data: text };
    }
  }

  private normalizeResponseShape(value: any, url?: string): any {
    if (!value || Array.isArray(value) || typeof value !== "object")
      return value;

    if (url && url.includes("/download-info")) {
      if (value.downloadInfo === undefined) {
        const candidate = value.result ?? value.data ?? value.response ?? value;
        if (candidate && typeof candidate === "object") {
          if (Array.isArray(candidate)) {
            value.downloadInfo = candidate;
          } else {
            Object.assign(value, candidate);
            value.downloadInfo = candidate.downloadInfo ?? candidate;
          }
          return value;
        }
      }
    }

    const wrapper = value.result ?? value.data ?? value.response;
    if (wrapper && typeof wrapper === "object" && !Array.isArray(wrapper)) {
      return Object.assign({}, value, wrapper);
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
