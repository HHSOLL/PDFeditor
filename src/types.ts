import type { PDFFont } from "pdf-lib";

export type Tool = "select" | "text" | "highlight" | "rect" | "redact" | "pen" | "form";
export type AnnotationType = Exclude<Tool, "form"> | "image" | "formField";
export type EngineOperationType =
  | AnnotationType
  | "flowSlice"
  | "deleteAnnotation"
  | "deleteImage"
  | "deleteVector"
  | "cropPage"
  | "resizePage"
  | "redactPage"
  | "redactSearch"
  | "moveImage"
  | "typedSignature"
  | "drawnSignature"
  | "signatureImage"
  | "fileAttachment";
export type SaveMode = "flatten" | "native";
export type RedactionMode = "textOnly" | "visualArea" | "imagesAndText";
export type FormFieldType = "text" | "checkbox" | "radio" | "combo" | "list" | "signature";

export interface PageItem {
  id: string;
  sourceIndex: number;
  rotation: number;
  width?: number;
  height?: number;
  cropBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  sourcePdfBase64?: string;
  password?: string;
}

export interface DocumentMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  language?: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface AnnotationBase {
  id: string;
  pageId: string;
  type: AnnotationType;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  opacity: number;
  strokeWidth: number;
  sourceAnnotationId?: string;
  sourceAnnotationSubtype?: string;
  sourceImageId?: string;
  sourceVectorId?: string;
  dirty?: boolean;
}

export interface TextAnnotation extends AnnotationBase {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily?: string;
  fontName?: string;
  reflowable?: boolean;
  sourceTextId?: string;
  eraseOriginal?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface ImageAnnotation extends AnnotationBase {
  type: "image";
  dataUrl: string;
}

export interface PenAnnotation extends AnnotationBase {
  type: "pen";
  points: Point[];
}

export interface FormFieldAnnotation extends AnnotationBase {
  type: "formField";
  fieldName: string;
  fieldType: FormFieldType;
  fieldValue: string;
  checked?: boolean;
  exportValue?: string;
  defaultValue?: string;
  required?: boolean;
  readOnly?: boolean;
  tabIndex?: number;
  unsupportedReason?: string;
  options?: string[];
}

export type BoxAnnotation = AnnotationBase & {
  type: "highlight" | "rect" | "redact";
};

export type Annotation = TextAnnotation | ImageAnnotation | PenAnnotation | FormFieldAnnotation | BoxAnnotation;

export interface Snapshot {
  annotations: Annotation[];
  pageItems: PageItem[];
  currentPageId: string | null;
  documentMetadata: DocumentMetadata;
  saveMode: SaveMode;
  redactionMode: RedactionMode;
  sanitizeHiddenInfo: boolean;
  deletedSourceAnnotations: SourceAnnotationRef[];
}

export interface SourceAnnotationRef {
  sourceAnnotationId: string;
  pageId: string;
  subtype: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourceImageItem {
  id: string;
  pageId: string;
  sourceImageId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DragState {
  id: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  original: Annotation;
}

export interface DraftState {
  type: "box" | "pen";
  tool: Extract<Tool, "highlight" | "rect" | "redact" | "pen">;
  pageId: string;
  startX: number;
  startY: number;
  points: Point[];
}

export interface SourceTextItem {
  id: string;
  pageId: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  fontName: string;
  lineCount: number;
  reflowable: boolean;
}

export interface SourceMask {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlowedSourceText {
  id: string;
  item: SourceTextItem;
  pageId: string;
  y: number;
}

export interface PageFlowSlice {
  id: string;
  pageId: string;
  x: number;
  sourceY: number;
  y: number;
  width: number;
  height: number;
}

export interface EditorFonts {
  korean: PDFFont;
  latin: PDFFont;
}

export interface EngineOperation {
  type: EngineOperationType;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  sourceY?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontName?: string;
  color?: string;
  opacity?: number;
  strokeWidth?: number;
  lineHeight?: number;
  sourceAnnotationId?: string;
  annotationSubtype?: string;
  sourceImageId?: string;
  sourceVectorId?: string;
  eraseOriginal?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  points?: Point[];
  dataUrl?: string;
  fieldName?: string;
  fieldType?: string;
  fieldValue?: string;
  checked?: boolean;
  exportValue?: string;
  defaultValue?: string;
  required?: boolean;
  readOnly?: boolean;
  tabIndex?: number;
  options?: string[];
  create?: boolean;
  targetX?: number;
  targetY?: number;
  targetWidth?: number;
  targetHeight?: number;
  pattern?: string;
  regex?: boolean;
  caseSensitive?: boolean;
  signerName?: string;
  fileName?: string;
  fileBase64?: string;
  description?: string;
}

export interface EngineSourceText {
  pageIndex: number;
  sourceTextId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  fontName: string;
}

export interface EnginePayload {
  pdfBase64: string;
  password?: string;
  pages: Array<{
    sourceIndex: number;
    rotation: number;
    width?: number;
    height?: number;
    cropBox?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    sourcePdfBase64?: string;
    password?: string;
  }>;
  operations: EngineOperation[];
  sourceTexts: EngineSourceText[];
  metadata: DocumentMetadata;
  saveOptions: {
    annotationMode: SaveMode;
    redactionMode: RedactionMode;
    flattenForms?: boolean;
    sanitize?: boolean;
    sanitizeOptions?: {
      metadata?: boolean;
      xmlMetadata?: boolean;
      embeddedFiles?: boolean;
      fileAttachmentAnnotations?: boolean;
      javascript?: boolean;
      javascriptNameTree?: boolean;
      annotationActions?: boolean;
      comments?: boolean;
      hiddenLayers?: boolean;
      embeddedSearchIndex?: boolean;
      staleIncrementalUpdates?: boolean;
      unreferencedObjects?: boolean;
      links?: boolean;
      thumbnails?: boolean;
      resetFormFields?: boolean;
    };
    validate: boolean;
    encrypt?: boolean;
    userPassword?: string;
    ownerPassword?: string;
    permissions?: {
      print?: boolean;
      copy?: boolean;
      annotate?: boolean;
      edit?: boolean;
    };
  };
}

export interface EngineApplyResponse {
  pdfBase64: string;
  validation?: ExportValidation;
}

export interface ExportValidation {
  ok: boolean;
  pageCount: number;
  encrypted: boolean;
  qpdfChecked?: boolean;
  annotationCount?: number;
  textLength?: number;
  pageSizes?: Array<{ width: number; height: number }>;
  errors: string[];
}

export interface PreflightReport {
  ok: boolean;
  warnings: string[];
  pageCount: number;
  metadataPresent: boolean;
  xmpPresent: boolean;
  embeddedFileCount: number;
  javascriptCount: number;
  javascriptNameTreeCount?: number;
  formFieldCount: number;
  signatureFieldCount?: number;
  xfaPresent?: boolean;
  explicitTabOrderPageCount?: number;
  fontCount: number;
  hiddenLayerCount?: number;
  commentAnnotationCount?: number;
  fileAttachmentAnnotationCount?: number;
  annotationActionCount?: number;
  linkActionCount?: number;
  embeddedSearchIndexCount?: number;
  staleIncrementalSaveCount?: number;
  unreferencedObjectSignalCount?: number;
  pdfaClaim?: string;
  pdfxClaim?: string;
  outputIntentCount?: number;
}

export interface OcrStatus {
  ok: boolean;
  engine: string;
  path: string;
  version: string;
  tessdata: string;
  requestedLanguages: string[];
  availableLanguages: string[];
  missingLanguages: string[];
  errors: string[];
}

export interface OcrRequest {
  bytes: Uint8Array;
  password?: string;
  language?: string;
  pages?: string;
  dpi?: number;
  force?: boolean;
}

export interface CertificateSignRequest {
  bytes: Uint8Array;
  certPem: string;
  keyPem: string;
  keyPassword?: string;
  password?: string;
  fieldName?: string;
  signerName?: string;
  reason?: string;
  location?: string;
  pageIndex?: number;
  rect?: { x: number; y: number; width: number; height: number };
  placeholderBytes?: number;
  lockPolicy?: "none" | "noChanges" | "formFill" | "formFillAnnotate";
}

export interface OcrCorrection {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize?: number;
}

export interface OcrCorrectionRequest {
  bytes: Uint8Array;
  password?: string;
  dpi?: number;
  corrections: OcrCorrection[];
}

export interface AccessibilityAltText {
  pageIndex?: number;
  imageIndex?: number;
  xref?: number;
  altText: string;
}

export interface AccessibilityRepairRequest {
  bytes: Uint8Array;
  password?: string;
  title?: string;
  language?: string;
  altTexts?: AccessibilityAltText[];
}

export interface SignatureValidation {
  ok: boolean;
  signatureCount: number;
  signatureWidgetCount: number;
  signedWidgetCount: number;
  validation: ExportValidation;
  signatures: Array<{
    index: number;
    ok: boolean;
    byteRange?: number[];
    signedByteCount?: number;
    signatureLength?: number;
    cmsVerified?: boolean;
    docMDP?: boolean;
    lockPolicy?: "none" | "noChanges" | "formFill" | "formFillAnnotate";
    errors: string[];
  }>;
  errors: string[];
}

export interface CompareResult {
  ok: boolean;
  leftPageCount: number;
  rightPageCount: number;
  pageCountChanged: boolean;
  changedPages: number[];
  changedPageCount: number;
  textChanges: Array<{
    pageIndex: number;
    type?: string;
    leftPreview: string;
    rightPreview: string;
  }>;
  renderChanges: Array<{
    pageIndex: number;
    meanPixelDelta: number;
    changedRegion?: number[];
  }>;
  reportBase64?: string;
  errors: string[];
}

export interface BatchJobRequest {
  fileName: string;
  bytes: Uint8Array;
  payload: EnginePayload;
}

export interface BatchResult {
  ok: boolean;
  jobCount: number;
  successCount: number;
  failureCount: number;
  jobs: Array<{
    index: number;
    ok: boolean;
    input?: string;
    output?: string;
    pdfBase64?: string;
    validation?: ExportValidation;
    error?: string;
  }>;
}

export interface PdfTextItem {
  str: string;
  fontName: string;
  transform: [number, number, number, number, number, number];
  width: number;
  height: number;
}

export interface PdfTextStyle {
  fontFamily?: string;
}
