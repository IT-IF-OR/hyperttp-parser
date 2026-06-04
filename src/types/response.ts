import type { InternalRequest, ResponseType } from "@hyperttp/types";
import type { XmlBuilderOptions } from "fast-xml-builder";

export interface ResponseConverterOptions {
  /**
   * @ru Разрешить автоматический парсинг ответов со статус-кодами ошибок (>= 400)
   */
  parseErrors?: boolean;

  /**
   * @ru Максимальный размер тела ответа (байты), 0 = без ограничений
   */
  maxBodySize?: number;

  /**
   * @ru Парсить HTML в DOM структуру
   */
  parseHTML?: boolean;

  /**
   * @ru Режим парсинга HTML
   */
  htmlMode?: "simple" | "full";

  /**
   * @ru Кодировка текста
   */
  charset?: BufferEncoding;

  /**
   * @ru Строгие опции для fast-xml-parser (чтение XML)
   */
  xmlParserOptions?: Record<string, any>; // Оставляем гибким или импортируем из fast-xml-parser

  /**
   * @ru Строгие опции для fast-xml-builder (сборка XML)
   */
  xmlBuilderOptions?: XmlBuilderOptions;
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
