import type { InternalRequest, ResponseType } from "@hyperttp/types";

export interface ResponseConverterOptions {
  charset?: BufferEncoding;
  maxBodySize?: number;
  parseHTML?: boolean;
  htmlMode?: "simple" | "full";
  xmlParserOptions?: Record<string, unknown>;
  parseErrors?: boolean;
}

/**
 * @ru Парсированный ответ сервера
 */
export type ParsedResponse =
  | string
  | Buffer
  | Record<string, any>
  | any[]
  | null
  | any;

/**
 * @ru Интерфейс внутреннего запроса, содержащий конфигурацию для `hyperttp-parser`
 * @en Internal request interface containing configuration for `hyperttp-parser`
 */
export interface ParsableRequest extends InternalRequest {
  meta?: {
    /**
     * @ru Локальные настройки конвертера, переопределяющие глобальные для этого конкретного запроса
     * @en Local converter options overriding global ones for this specific request
     */
    responseConverter?: ResponseConverterOptions;

    /**
     * @ru Явно указанный тип ответа, к которому нужно привести результат
     * @en Explicitly specified response type to cast the result to
     */
    responseType?: ResponseType;

    /**
     * @ru Сигнатура для поддержки остальных мета-полей других плагинов ядра
     * @en Index signature to support other meta fields from core plugins
     */
    [key: string]: any;
  };
}

export interface ParsableRequest extends InternalRequest {
  meta?: {
    responseConverter?: ResponseConverterOptions;
    responseType?: ResponseType;
    [key: string]: any;
  };
}
