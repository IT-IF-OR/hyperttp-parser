import { HyperPlugin, PluginContext } from "@hyperttp/types";
import { ResponseConverter } from "./utils/ResponseConverter.js";
import type { ResponseConverterOptions } from "./types/response.js";
import { normalizeHeaders } from "./utils/helpers.js";

declare module "@hyperttp/types" {
  interface HyperttpPluginsExtension {
    responseConverter?: ResponseConverterOptions;
  }
}

function fastKey(opts?: Partial<ResponseConverterOptions>): string {
  if (!opts) return "default";

  return [
    opts.charset ?? "",
    opts.htmlMode ?? "",
    opts.parseHTML === false ? "0" : "1",
    opts.maxBodySize ?? "",
    opts.parseErrors === true ? "1" : "0",
  ].join("|");
}

export function withParser(
  pluginOptions: Partial<ResponseConverterOptions> = {},
): HyperPlugin {
  let globalOptions!: ResponseConverterOptions;
  let defaultConverter!: ResponseConverter;

  const converterCache = new Map<string, ResponseConverter>();

  return {
    name: "hyperttp-parser",
    phase: "FORMAT",

    setup(ctx: PluginContext): void {
      globalOptions = {
        parseHTML: true,
        htmlMode: "full",
        parseErrors: false,
        ...ctx.config.responseConverter,
        ...pluginOptions,
      };

      defaultConverter = new ResponseConverter(globalOptions);
    },

    async onResponse(res, req): Promise<void> {
      if (!res || res.body == null) return;

      if (req?.method === "HEAD") return;

      const status = res.status;
      if (status === 204 || status === 205 || status === 304) {
        res.body = null;
        return;
      }

      const meta = (req as any)?.meta ?? {};
      const targetType = meta.responseType ?? "auto";

      if (targetType === "stream") return;

      let converter = defaultConverter;

      const localOptions = meta.responseConverter;
      if (localOptions) {
        const cacheKey = fastKey(localOptions);

        let cached = converterCache.get(cacheKey);
        if (!cached) {
          cached = new ResponseConverter({
            ...globalOptions,
            ...localOptions,
          });
          converterCache.set(cacheKey, cached);
        }

        converter = cached;
      }

      const { contentType, contentEncoding } = normalizeHeaders(res.headers);

      res.body =
        (await converter.convert(res.body, targetType, {
          contentType,
          contentEncoding,
          url: res.url,
        })) ?? null;
    },
  };
}
