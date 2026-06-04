import type {
  HttpResponse,
  HyperPlugin,
  InternalRequest,
  PluginContext,
} from "@hyperttp/types";
import type {
  ResponseConverterOptions,
  ParsableRequest,
} from "./types/response.js";

import { ResponseConverter } from "./utils/ResponseConverter.js";

declare module "@hyperttp/types" {
  interface HyperttpPluginsExtension {
    responseConverter?: ResponseConverterOptions;
  }
}

/**
 * @ru Плагин автоматического парсинга и трансформации тела ответа (JSON, Text, Buffer и др.).
 * @en Automatic response body parsing and transformation plugin (JSON, Text, Buffer, etc.).
 */
export function withParser(
  pluginOptions?: Partial<ResponseConverterOptions>,
): HyperPlugin {
  let globalOptions: ResponseConverterOptions;
  let defaultConverter: ResponseConverter;

  /**
   * @private
   * @ru Кэш экземпляров конвертера для кастомных локальных опций запроса.
   */
  const converterCache = new WeakMap<object, ResponseConverter>();

  return {
    name: "hyperttp-parser",
    phase: "FORMAT",

    setup(ctx: PluginContext): void {
      globalOptions = {
        parseErrors: false,
        ...ctx.config.responseConverter,
        ...pluginOptions,
      };

      defaultConverter = new ResponseConverter(ctx.core, globalOptions);
    },

    async onResponse(
      res: HttpResponse<any>,
      req?: InternalRequest,
      ctx?: PluginContext,
    ): Promise<void> {
      if (!res) return;

      if (res.status === 204 || res.status === 205 || res.status === 304) {
        res.body = null;
        return;
      }

      const parsableReq = req as ParsableRequest;
      const localOptions = parsableReq.meta?.responseConverter;

      const currentOptions = localOptions
        ? { ...globalOptions, ...localOptions }
        : globalOptions;

      if (
        req!.method === "HEAD" ||
        res.body == null ||
        (!currentOptions.parseErrors && res.status >= 400)
      ) {
        return;
      }

      const targetType = parsableReq.meta?.responseType ?? "auto";
      if (targetType === "stream") {
        return;
      }

      let converter = defaultConverter;
      if (localOptions) {
        const key = localOptions as object;
        const cached = converterCache.get(key);

        if (cached) {
          converter = cached;
        } else {
          converter = new ResponseConverter(ctx!.core, currentOptions);
          converterCache.set(key, converter);
        }
      }

      const headers = res.headers;
      const contentType = headers["content-type"] ?? headers["Content-Type"];
      const contentEncoding =
        headers["content-encoding"] ?? headers["Content-Encoding"];

      const parsed = await converter.convertAsync(res, targetType, {
        contentType: typeof contentType === "string" ? contentType : undefined,
        contentEncoding:
          typeof contentEncoding === "string" ? contentEncoding : undefined,
        url: res.url,
      });

      res.body = parsed;
    },
  };
}
