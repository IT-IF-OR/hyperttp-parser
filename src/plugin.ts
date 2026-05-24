import {
  HttpResponse,
  HyperPlugin,
  type InternalRequest,
  type ResponseType,
  type PluginContext,
} from "@hyperttp/core";

import type { ResponseConverterOptions } from "./types/response.js";
import { ResponseConverter } from "./utils/ResponseConverter.js";

export interface ParsableRequest extends InternalRequest {
  meta?: InternalRequest["meta"] & {
    responseType?: ResponseType;
    responseConverter?: Partial<ResponseConverterOptions>;
  };
}

declare module "@hyperttp/core" {
  interface HyperttpPluginsExtension {
    responseConverter?: ResponseConverterOptions;
  }
}

export function withParser(
  pluginOptions?: Partial<ResponseConverterOptions>,
): HyperPlugin {
  let mergedGlobalOptions: ResponseConverterOptions | null = null;
  let defaultConverter: ResponseConverter | null = null;

  return {
    name: "hyperttp-parser",
    phase: "FORMAT",
    enabled: () => true,

    setup(ctx: PluginContext) {
      mergedGlobalOptions = {
        ...ctx.config.responseConverter,
        ...pluginOptions,
      };
      defaultConverter = new ResponseConverter(mergedGlobalOptions);
    },

    wrapDispatch(next, ctx: PluginContext) {
      const options = mergedGlobalOptions ?? {
        ...ctx.config.responseConverter,
        ...pluginOptions,
      };
      const converterInstance =
        defaultConverter ?? new ResponseConverter(options);

      return async function dispatchWithParser<T>(
        req: InternalRequest,
      ): Promise<HttpResponse<T>> {
        const res = await next<T>(req);

        if (req.method === "HEAD" || !res || !res.body || res.status >= 400) {
          return res;
        }

        const parsableReq = req as ParsableRequest;
        const localOptions = parsableReq.meta?.responseConverter;

        const converter = localOptions
          ? new ResponseConverter({ ...options, ...localOptions })
          : converterInstance;

        const buffer = await converter.readBody(res.body);
        const targetType = parsableReq.meta?.responseType ?? "auto";

        const headers = res.headers;
        const contentType = headers["content-type"] ?? headers["Content-Type"];
        const contentEncoding =
          headers["content-encoding"] ?? headers["Content-Encoding"];

        const parsed = converter.convert(buffer, targetType, {
          contentType:
            typeof contentType === "string" ? contentType : undefined,
          contentEncoding:
            typeof contentEncoding === "string" ? contentEncoding : undefined,
          url: res.url,
        });

        (res as any).body = parsed;
        return res;
      };
    },
  };
}
