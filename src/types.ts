import type { PDFFont } from "pdf-lib";

export type Tool = "select" | "text" | "highlight" | "rect" | "redact" | "pen";
export type AnnotationType = Tool | "image" | "formField";
export type EngineOperationType = AnnotationType | "flowSlice" | "deleteAnnotation" | "deleteImage";
export type SaveMode = "flatten" | "native";
export type RedactionMode = "textOnly" | "visualArea" | "imagesAndText";

export interface PageItem {
  id: string;
  sourceIndex: number;
  rotation: number;
}

export interface DocumentMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
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
  fieldType: "text" | "checkbox";
  fieldValue: string;
  checked?: boolean;
  exportValue?: string;
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
  pages: Array<{ sourceIndex: number; rotation: number }>;
  operations: EngineOperation[];
  sourceTexts: EngineSourceText[];
  metadata: DocumentMetadata;
  saveOptions: {
    annotationMode: SaveMode;
    redactionMode: RedactionMode;
    flattenForms?: boolean;
    validate: boolean;
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
