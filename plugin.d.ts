import type { HyperPlugin } from "@hyperttp/types";
import type { ResponseConverterOptions } from "./types/response.js";
declare module "@hyperttp/types" {
    interface HyperClientOptions {
        responseConverter?: ResponseConverterOptions | false;
    }
}
export declare function withParser(pluginOptions?: Partial<ResponseConverterOptions>): HyperPlugin;
//# sourceMappingURL=plugin.d.ts.map