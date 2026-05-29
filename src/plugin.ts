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
 * @param pluginOptions - Custom options to override global configuration.
 * @returns HyperPlugin object instance.
 */
export function withParser(
  pluginOptions?: Partial<ResponseConverterOptions>,
): HyperPlugin {
  let globalOptions: ResponseConverterOptions;
  let defaultConverter: ResponseConverter;

  /**
   * @private
   * @ru Кэш экземпляров конвертера для кастомных локальных опций запроса.
   * @en Converter instances cache for custom local request options.
   */
  const converterCache = new WeakMap<object, ResponseConverter>();

  return {
    name: "hyperttp-parser",

    phase: "FORMAT",

    /**
     * @ru Хук инициализации. Настраивает глобальные опции и связывает конвертер с ядром.
     */
    setup(ctx: PluginContext): void {
      globalOptions = {
        ...ctx.config.responseConverter,
        ...pluginOptions,
      };

      defaultConverter = new ResponseConverter(ctx.core, globalOptions);
    },

    /**
     * @ru Перехватчик фазы успешного ответа. Выполняет асинхронную конвертацию.
     */
    async onResponse(
      res: HttpResponse<any>,
      req?: InternalRequest,
      ctx?: PluginContext,
    ): Promise<void> {
      if (
        !res ||
        req!.method === "HEAD" ||
        res.status >= 400 ||
        res.body == null
      ) {
        return;
      }

      const parsableReq = req as ParsableRequest;
      const targetType = parsableReq.meta?.responseType ?? "auto";

      if (targetType === "stream") {
        return;
      }

      const localOptions = parsableReq.meta?.responseConverter;
      let converter = defaultConverter;

      if (localOptions) {
        const key = localOptions as object;
        const cached = converterCache.get(key);

        if (cached) {
          converter = cached;
        } else {
          converter = new ResponseConverter(ctx!.core, {
            ...globalOptions,
            ...localOptions,
          });

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

      // Перезаписываем body результатом нативного парсинга
      res.body = parsed;
    },
  };
}
