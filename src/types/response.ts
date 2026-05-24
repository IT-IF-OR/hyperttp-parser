import type { InternalRequest } from "@hyperttp/core";

export interface ResponseConverterOptions {
  /**
   * @ru Максимальный размер тела ответа (байты), 0 = без ограничений
   * @en Maximum response body size (bytes), 0 = unlimited
   */
  maxBodySize?: number;

  /**
   * @ru Парсить HTML в DOM структуру
   * @en Parse HTML into DOM structure
   */
  parseHTML?: boolean;

  /**
   * @ru Режим парсинга HTML
   * @en HTML parsing mode
   */
  htmlMode?: "simple" | "full";

  /**
   * @ru Кодировка текста (ascii|utf8|utf-8|utf16le|ucs2|base64|latin1|binary|hex)
   * @en Text encoding (ascii|utf8|utf-8|utf16le|ucs2|base64|latin1|binary|hex)
   */
  charset?: BufferEncoding;
}

/**
 * @ru Парсированный ответ сервера
 * @en Parsed server response
 */
export type ParsedResponse =
  | string
  | Buffer
  | Record<string, any>
  | any[]
  | null;

/**
 * @ru Метаданные для конвертации ответа
 * @en Response conversion metadata
 */
export interface ConversionMeta {
  /**
   * @ru Content-Type заголовок
   * @en Content-Type header
   */
  contentType?: string;
  /**
   * @ru Content-Encoding заголовок
   * @en Content-Encoding header
   */
  contentEncoding?: string;
  /**
   * @ru URL запроса
   * @en Request URL
   */
  url?: string;
}

export type ResponseType =
  | "auto"
  | "json"
  | "text"
  | "xml"
  | "html"
  | "buffer"
  | "blob"
  | "stream";

export type SourceType = "json" | "xml" | "html" | "text" | "buffer";

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
