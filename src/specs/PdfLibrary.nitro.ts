import type { HybridObject } from 'react-native-nitro-modules';

/** Page size in PDF points, with the page's rotation applied. */
export interface PageSize {
  width: number;
  height: number;
}

export interface PageMetrics {
  page: number;
  width: number;
  height: number;
  rotation: number;
}

/** A point in PDF points, measured from the top-left corner of the displayed page. */
export interface PdfPoint {
  x: number;
  y: number;
}

/** A rectangle in PDF points, measured from the top-left corner of the displayed page. */
export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SearchResult {
  page: number;
  text: string;
  rect: PdfRect;
}

export type ImageFormat = 'jpeg' | 'png';

export interface RenderOptions {
  /** Largest width of the image in pixels. The aspect ratio is kept. */
  maxWidth?: number;
  /** Largest height of the image in pixels. The aspect ratio is kept. */
  maxHeight?: number;
  /** Pixels per PDF point when no size limit applies. Defaults to 2. */
  scale?: number;
  format?: ImageFormat;
  /** JPEG quality from 0 to 100. Defaults to 90. */
  quality?: number;
  /** Background colour as `#RRGGBB`. Defaults to white. */
  background?: string;
  /** Where to write the image. Defaults to a file in the library's render cache. */
  outputPath?: string;
}

export interface ThumbnailOptions {
  /** Zero-based pages to render. Defaults to every page. */
  pages?: number[];
  maxWidth?: number;
  maxHeight?: number;
  format?: ImageFormat;
  quality?: number;
  background?: string;
  /** Directory for the images. Defaults to the library's render cache. */
  outputDir?: string;
}

export interface RenderedImage {
  page: number;
  /** `file://` URI of the image. */
  uri: string;
  /** Absolute path of the image. */
  path: string;
  width: number;
  height: number;
}

export type AddableAnnotationType = 'highlight' | 'ink' | 'freeText' | 'note' | 'stamp';

export type AnnotationType =
  | 'highlight'
  | 'ink'
  | 'freeText'
  | 'note'
  | 'stamp'
  | 'underline'
  | 'strikeOut'
  | 'square'
  | 'circle'
  | 'line'
  | 'link'
  | 'widget'
  | 'popup'
  | 'other';

export interface InkStroke {
  points: PdfPoint[];
}

export interface AnnotationInput {
  page: number;
  type: AddableAnnotationType;
  rect: PdfRect;
  /** `#RRGGBB` or `#RRGGBBAA`. */
  color?: string;
  /** Text of a note, free-text or stamp annotation. */
  text?: string;
  /** Strokes of an ink annotation. */
  strokes?: InkStroke[];
}

export interface PdfAnnotation {
  page: number;
  /** Index of the annotation on its page. Changes when annotations before it are removed. */
  index: number;
  type: AnnotationType;
  rect: PdfRect;
  color: string;
  contents: string;
}

export type FormFieldType =
  | 'text'
  | 'checkbox'
  | 'radio'
  | 'combobox'
  | 'listbox'
  | 'pushbutton'
  | 'signature'
  | 'unknown';

export interface PdfFormField {
  name: string;
  type: FormFieldType;
  value: string;
  checked: boolean;
  options: string[];
  page: number;
  readOnly: boolean;
}

export interface PdfPermissions {
  print?: boolean;
  copy?: boolean;
  modify?: boolean;
  annotate?: boolean;
}

export interface SaveOptions {
  userPassword?: string;
  ownerPassword?: string;
  permissions?: PdfPermissions;
}

/** One outline (bookmark) entry, flattened depth-first. `level` 0 is the top. */
export interface OutlineItem {
  title: string;
  page: number;
  level: number;
}

export interface KB16Support {
  supported: boolean;
  platform: string;
  message: string;
  googlePlayCompliant: boolean;
  ndkVersion: string;
  buildFlags: string;
}

export interface PdfCacheInfo {
  cacheId: string;
  filePath: string;
  fileSize: number;
}

export interface PdfCacheStats {
  fileCount: number;
  totalBytes: number;
  hitRatio: number;
}

/**
 * An open PDF. Cheap reads are synchronous. Rendering, search, text, OCR,
 * editing and saving return Promises. Page indexes are zero-based.
 *
 * Edits (rotate, delete, move, insert, annotations, forms) change the open
 * document only. Nothing is written until `save(outputPath)`.
 *
 * Errors carry a stable code as a `[code]` prefix of the message; see
 * `src/errors.ts`.
 */
export interface PdfDocument
  extends HybridObject<{ ios: 'swift'; android: 'c++' }> {
  readonly pageCount: number;
  readonly path: string;
  readonly isEncrypted: boolean;
  readonly hasUnsavedChanges: boolean;
  pageSize(index: number): PageSize;
  pageMetrics(index: number): PageMetrics;
  getOutline(): Promise<OutlineItem[]>;

  renderPage(index: number, options?: RenderOptions): Promise<RenderedImage>;
  renderThumbnails(options?: ThumbnailOptions): Promise<RenderedImage[]>;

  searchText(term: string, startPage: number, endPage: number): Promise<SearchResult[]>;
  extractText(index: number): Promise<string>;
  extractTextFromPages(pageIndicesJson: string): Promise<string>;
  extractAllText(): Promise<string>;
  recognizeText(index: number, fast: boolean): Promise<string>;

  rotatePage(index: number, degrees: number): Promise<void>;
  deletePage(index: number): Promise<void>;
  movePage(from: number, to: number): Promise<void>;
  insertPages(fromPath: string, atIndex: number, pages?: number[], password?: string): Promise<void>;

  addAnnotation(annotation: AnnotationInput): Promise<number>;
  getAnnotations(page: number): Promise<PdfAnnotation[]>;
  removeAnnotation(page: number, index: number): Promise<void>;

  getFormFields(): Promise<PdfFormField[]>;
  setFormFieldValues(values: Record<string, string>): Promise<void>;
  flattenForms(): Promise<void>;

  save(outputPath: string, options?: SaveOptions): Promise<string>;
  close(): void;
}

/**
 * Process-wide PDF entry point. `open` is the only way to get a document.
 */
export interface PdfLibrary
  extends HybridObject<{ ios: 'swift'; android: 'c++' }> {
  open(path: string, password?: string): Promise<PdfDocument>;
  readonly version: string;
  readonly kb16Support: KB16Support;
  readonly ocrAvailable: boolean;
  mergePDFs(filePaths: string[], outputPath: string): Promise<string>;
  splitPDF(filePath: string, pageRangesJson: string, outputDir: string): Promise<string>;
  extractPages(filePath: string, pageNumbersJson: string, outputPath: string): Promise<string>;
  compressPDF(inputPath: string, outputPath: string, compressionLevel: number): Promise<string>;
  storeCachedPdf(base64: string, identifier: string): Promise<PdfCacheInfo>;
  cachedPdfPath(identifier: string): Promise<string>;
  removeCachedPdf(identifier: string): Promise<boolean>;
  clearPdfCache(): Promise<boolean>;
  clearExpiredPdfs(): Promise<number>;
  pdfCacheStats(): Promise<PdfCacheStats>;
}
