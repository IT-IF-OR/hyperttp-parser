import {
  HttpResponse,
  HyperPlugin,
  type InternalRequest,
  type PluginContext,
} from "@hyperttp/core";

import type {
  ResponseConverterOptions,
  ParsableRequest,
} from "./types/response.js";

import { ResponseConverter } from "./utils/ResponseConverter.js";

declare module "@hyperttp/core" {
  interface HyperttpPluginsExtension {
    responseConverter?: ResponseConverterOptions;
  }
}

export function withParser(
  pluginOptions?: Partial<ResponseConverterOptions>,
): HyperPlugin {
  let globalOptions: ResponseConverterOptions;
  let defaultConverter: ResponseConverter;

  const converterCache = new WeakMap<object, ResponseConverter>();

  return {
    name: "hyperttp-parser",
    phase: "FORMAT",
    enabled: () => true,

    setup(ctx: PluginContext) {
      globalOptions = {
        ...ctx.config.responseConverter,
        ...pluginOptions,
      };

      defaultConverter = new ResponseConverter(globalOptions);
    },

    wrapDispatch(next, ctx: PluginContext) {
      const baseOptions = globalOptions ?? ctx.config.responseConverter ?? {};

      return async function dispatchWithParser<T>(
        req: InternalRequest,
      ): Promise<HttpResponse<T>> {
        const res = await next<T>(req);

        if (
          !res ||
          req.method === "HEAD" ||
          res.status >= 400 ||
          res.body == null
        ) {
          return res;
        }

        const parsableReq = req as ParsableRequest;
        const targetType = parsableReq.meta?.responseType ?? "auto";

        if (targetType === "stream") {
          return res;
        }

        const localOptions = parsableReq.meta?.responseConverter;

        let converter = defaultConverter;

        if (localOptions) {
          const key = localOptions as object;
          const cached = converterCache.get(key);

          if (cached) {
            converter = cached;
          } else {
            converter = new ResponseConverter({
              ...baseOptions,
              ...localOptions,
            });

            converterCache.set(key, converter);
          }
        }

        const headers = res.headers;

        const contentType = headers["content-type"] ?? headers["Content-Type"];
        const contentEncoding =
          headers["content-encoding"] ?? headers["Content-Encoding"];

        const parsed = await converter.convertAsync(res.body, targetType, {
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
