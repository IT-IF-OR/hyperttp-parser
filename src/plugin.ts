import type {
  HyperCore,
  HyperPlugin,
  InternalRequest,
  HttpClientOptions,
} from "@hyperttp/core";
import type { ResponseConverterOptions } from "./types/response.js";
import { ResponseConverter } from "./utils/ResponseConverter.js";

export function withParser(
  client: HyperCore,
  options?: ResponseConverterOptions,
): HyperCore {
  const next = client.dispatch.bind(client);
  const converter = new ResponseConverter(options);

  const safeDestroy = (body: any) => {
    if (!body) return;
    if (typeof body.on === "function") body.on("error", () => {});

    if (typeof body.cancel === "function") {
      body.cancel().catch(() => {});
    } else if (typeof body.destroy === "function") {
      if (!body.destroyed) body.destroy();
    }
  };

  client.dispatch = async <T = any>(req: InternalRequest): Promise<T> => {
    const responseType = req.meta?.responseType || "auto";

    if (
      req.method === "HEAD" ||
      responseType === "buffer" ||
      responseType === "stream"
    ) {
      return next(req) as T;
    }

    const rawResponse = await next<any>(req);

    if (!rawResponse?.body) {
      return rawResponse as T;
    }

    if (rawResponse.status && rawResponse.status >= 400) {
      safeDestroy(rawResponse.body);
      return rawResponse as T;
    }

    const { headers, body } = rawResponse;
    const isLogging = req.meta?.trackTimings;
    const start = isLogging ? process.hrtime.bigint() : 0n;

    let bufferBody;
    try {
      bufferBody = await converter.readBody(body);
    } catch (readErr) {
      safeDestroy(body);
      throw readErr;
    }

    const currentUrl = (rawResponse.url || req.url) as string | undefined;

    const parsedData = await converter.convert(bufferBody, responseType, {
      contentType: headers["content-type"] || headers["Content-Type"],
      contentEncoding:
        headers["content-encoding"] || headers["Content-Encoding"],
      url: currentUrl,
    });

    if (isLogging) {
      const end = process.hrtime.bigint();
      req.meta = req.meta || {};
      req.meta.timings = req.meta.timings || {};
      req.meta.timings.parsingMs = Number(end - start) / 1e6;
    }

    rawResponse.body = parsedData;
    return rawResponse as T;
  };

  return client;
}

declare module "@hyperttp/core" {
  interface HyperttpPluginsExtension {
    responseConverter?: ResponseConverterOptions;
  }
}

export const ParserPlugin: HyperPlugin = {
  name: "hyperttp-parser",
  phase: "FORMAT",
  enabled: () => true,
  apply: (client: HyperCore, config: HttpClientOptions) =>
    withParser(client, config.responseConverter),
};
