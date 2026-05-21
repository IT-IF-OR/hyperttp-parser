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
  | "stream";

export type SourceType = "json" | "xml" | "html" | "text" | "buffer";
