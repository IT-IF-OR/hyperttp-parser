import type { ConversionMeta, ResponseType } from "../types/response.js";
import type { ResponseConverterOptions } from "../types/response.js";
type ParsedResponse = unknown;
export declare class ResponseConverter {
    private readonly options;
    private readonly typeCache;
    private readonly charset;
    private readonly decoder;
    private readonly isBun;
    private _xmlParser;
    private _xmlPromise;
    private _htmlParser;
    private _htmlParserPromise;
    constructor(options?: ResponseConverterOptions);
    convert(body: unknown, targetType: ResponseType, meta?: ConversionMeta): Promise<ParsedResponse>;
    private convertBody;
    private tryNative;
    private bodyToBytes;
    private fast;
    private bytesToText;
    private tryParseJson;
    private resolveJsonBody;
    private slow;
    private toText;
    private readReadableStream;
    private readAsyncIterable;
    private readNodeStream;
    private chunkToBytes;
    private isTransportResponseLike;
    private detect;
    private safeJsonParseFallback;
    private htmlToJson;
    private getXmlParser;
    private getHtmlParser;
}
export {};
//# sourceMappingURL=ResponseConverter.d.ts.map