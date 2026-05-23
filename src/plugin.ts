import {
  HttpResponse,
  HyperPlugin,
  type InternalRequest,
  type ResponseType,
  type HttpClientOptions,
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

export function withParser(): HyperPlugin {
  let converter!: ResponseConverter;

  return {
    name: "hyperttp-parser",
    phase: "FORMAT",
    enabled: () => true,

    setup(_core, config: HttpClientOptions) {
      converter = new ResponseConverter(config.responseConverter);
    },

    wrapDispatch: (next) => {
      return async <T>(req: InternalRequest): Promise<HttpResponse<T>> => {
        const res = await next<T>(req);

        if (req.method === "HEAD") return res;
        if (!res?.body) return res;
        if (res.status >= 400) return res;

        const buffer = await converter.readBody(res.body);

        const targetType =
          (req as ParsableRequest).meta?.responseType ?? "auto";

        const contentType =
          res.headers["content-type"] || res.headers["Content-Type"];
        const contentEncoding =
          res.headers["content-encoding"] || res.headers["Content-Encoding"];

        const parsed = await converter.convert(buffer, targetType, {
          contentType:
            typeof contentType === "string" ? contentType : undefined,
          contentEncoding:
            typeof contentEncoding === "string" ? contentEncoding : undefined,
          url: res.url,
        });

        return {
          ...res,
          body: parsed as T,
        };
      };
    },
  };
}
