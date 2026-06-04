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
 * Генерирует быстрый детерминированный ключ для кэширования конфигураций парсера.
 * Предотвращает промахи кэша при передаче инлайновых объектов-литералов.
 */
function getOptionsKey(opts: ResponseConverterOptions): string {
  return `${opts.charset || "u8"}_${opts.maxBodySize || 0}_${opts.parseHTML !== false}_${opts.htmlMode || "d"}_${opts.parseErrors === true}`;
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
   * Кэш конвертеров по строковому хэшу их конфигурации.
   * Защищает горячий путь от создания дубликатов `ResponseConverter`.
   */
  const converterCache = new Map<string, ResponseConverter>();

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

      const status = res.status;
      if (status === 204 || status === 205 || status === 304) {
        res.body = null;
        return;
      }

      if (res.body == null) return;
      if (req && req.method === "HEAD") return;

      const parsableReq = req as ParsableRequest | undefined;
      const localOptions = parsableReq?.meta?.responseConverter;

      const shouldParseErrors =
        localOptions?.parseErrors ?? globalOptions.parseErrors;
      if (!shouldParseErrors && status >= 400) {
        return;
      }

      const targetType = parsableReq?.meta?.responseType ?? "auto";
      if (targetType === "stream") {
        return;
      }

      let converter = defaultConverter;

      if (localOptions) {
        const cacheKey = getOptionsKey(localOptions);
        const cached = converterCache.get(cacheKey);

        if (cached) {
          converter = cached;
        } else {
          const mergedOptions = { ...globalOptions, ...localOptions };
          converter = new ResponseConverter(ctx!.core, mergedOptions);
          converterCache.set(cacheKey, converter);
        }
      }

      const headers = res.headers;
      let contentType: string | undefined;
      let contentEncoding: string | undefined;

      if (headers) {
        const ct = headers["content-type"] ?? headers["Content-Type"];
        if (typeof ct === "string") contentType = ct;

        const ce = headers["content-encoding"] ?? headers["Content-Encoding"];
        if (typeof ce === "string") contentEncoding = ce;
      }

      res.body = await converter.convertAsync(res, targetType, {
        contentType,
        contentEncoding,
        url: res.url,
      });
    },
  };
}
