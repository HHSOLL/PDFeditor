import "./styles.css";
import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import { base64ToBytes, bytesToBase64 } from "./base64";
import { clamp, isMostlyHorizontalText, isNumberArray, multiplyMatrix } from "./geometry";
import { asMetadataString, emptyMetadata } from "./metadata";
import type {
  Annotation,
  BoxAnnotation,
  DocumentMetadata,
  DraftState,
  DragState,
  EditorFonts,
  EngineApplyResponse,
  EngineOperation,
  EnginePayload,
  EngineSourceText,
  ExportValidation,
  FlowedSourceText,
  FormFieldAnnotation,
  ImageAnnotation,
  PageFlowSlice,
  PageItem,
  PdfTextItem,
  PdfTextStyle,
  PenAnnotation,
  Point,
  RedactionMode,
  SaveMode,
  Snapshot,
  SourceAnnotationRef,
  SourceImageItem,
  SourceMask,
  SourceTextItem,
  TextAnnotation,
  Tool,
} from "./types";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
const editorFontUrl = "/fonts/AppleGothic.ttf";

const appRoot = requireAppRoot();

let originalBytes: Uint8Array | null = null;
let pdfDocument: pdfjs.PDFDocumentProxy | null = null;
let fileName = "edited.pdf";
let pageItems: PageItem[] = [];
let annotations: Annotation[] = [];
let deletedSourceAnnotations: SourceAnnotationRef[] = [];
let sourceTextItemsByPage = new Map<string, SourceTextItem[]>();
let sourceImageItemsByPage = new Map<string, SourceImageItem[]>();
let pageCanvasSnapshots = new Map<string, string>();
let documentMetadata: DocumentMetadata = emptyMetadata();
let saveMode: SaveMode = "flatten";
let redactionMode: RedactionMode = "textOnly";
let openPassword = "";
let currentPageId: string | null = null;
let selectedId: string | null = null;
let currentTool: Tool = "select";
let zoom = 1;
let pageWidth = 0;
let pageHeight = 0;
let dragState: DragState | null = null;
let draftState: DraftState | null = null;
let pendingImageDataUrl: string | null = null;
let undoStack: Snapshot[] = [];
let redoStack: Snapshot[] = [];
let toastTimer = 0;
let renderCycle = 0;

const tools: Array<{ id: Tool; label: string; icon: string }> = [
  { id: "select", label: "선택", icon: "↖" },
  { id: "text", label: "텍스트 편집", icon: "T" },
  { id: "highlight", label: "강조", icon: "▰" },
  { id: "pen", label: "그리기", icon: "╱" },
  { id: "rect", label: "도형", icon: "□" },
  { id: "redact", label: "지우기", icon: "⌫" },
];

const dom = {
  fileInput: document.createElement("input"),
  imageInput: document.createElement("input"),
};

type PdfPageViewport = {
  width: number;
  height: number;
  convertToViewportRectangle(rect: [number, number, number, number]): number[];
  convertToViewportPoint(x: number, y: number): number[];
};

type NormalizedRect = Pick<SourceAnnotationRef, "x" | "y" | "width" | "height">;
type EngineExtractImage = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
type EngineExtractPage = {
  index: number;
  images?: EngineExtractImage[];
};
type EngineExtractResponse = {
  pages: EngineExtractPage[];
};

function renderApp(): void {
  appRoot.innerHTML = `
    <main class="app-shell">
      <header class="app-header">
        <section class="app-brand" aria-label="앱">
          <div class="brand-mark">PDF</div>
          <strong>PDF 편집기</strong>
        </section>
        <section class="document-tabs" aria-label="열린 문서">
          <button class="doc-tab active" type="button">
            <span id="documentName">문서를 열어주세요</span>
            <span aria-hidden="true">×</span>
          </button>
          <button class="new-tab" type="button" title="새 탭">+</button>
        </section>
        <section class="app-actions" aria-label="문서 작업">
          <span class="saved-state">● 저장됨</span>
          <button class="icon-btn" id="undoButton" type="button" title="실행 취소">↶</button>
          <button class="icon-btn" id="redoButton" type="button" title="다시 실행">↷</button>
          <button class="action-btn primary" id="exportButton" type="button" aria-label="PDF 내보내기">저장</button>
          <button class="kebab-btn" type="button" title="더보기">⋮</button>
        </section>
      </header>
      <nav class="menu-bar" aria-label="문서 메뉴">
        <button id="openButton" type="button">파일</button>
        <button type="button">편집</button>
        <button type="button">보기</button>
        <button type="button">삽입</button>
        <button type="button">주석</button>
        <button type="button">페이지</button>
        <button type="button">도구</button>
        <button type="button">양식</button>
        <button type="button">보안</button>
      </nav>
      <section class="ribbon" aria-label="PDF 편집 도구">
        <nav class="toolbar" id="toolbar" aria-label="PDF 편집 도구"></nav>
        <section class="ribbon-controls" aria-label="보기 설정">
          <button class="icon-btn" id="zoomOutButton" type="button" title="축소">−</button>
          <span class="zoom-chip" data-zoom-label>100%</span>
          <button class="icon-btn" id="zoomInButton" type="button" title="확대">+</button>
          <button class="view-mode active" type="button" title="단일 페이지">▣</button>
          <button class="view-mode" type="button" title="맞춤 보기">▤</button>
        </section>
      </section>
      <section class="workspace">
        <aside class="activity-rail" aria-label="패널">
          <button class="rail-item active" type="button"><span>▯</span><small>페이지</small></button>
          <button class="rail-item" type="button"><span>⌑</span><small>북마크</small></button>
          <button class="rail-item" type="button"><span>☰</span><small>주석</small></button>
          <button class="rail-item" type="button"><span>▤</span><small>양식</small></button>
          <button class="rail-item" type="button"><span>⌘</span><small>첨부파일</small></button>
        </aside>
        <aside class="sidebar">
          <div class="panel-head">
            <strong>페이지</strong>
            <span class="status-line" id="pageCount">0</span>
          </div>
          <div class="page-list" id="pageList"></div>
        </aside>
        <section class="canvas-area" id="canvasArea"></section>
        <aside class="inspector">
          <div class="panel-head">
            <strong>속성</strong>
            <span class="status-line" id="statusLine"></span>
          </div>
          <div class="inspector-body" id="inspectorBody"></div>
        </aside>
      </section>
      <footer class="bottom-bar">
        <div></div>
        <section class="bottom-controls" aria-label="페이지 보기">
          <button class="icon-btn" type="button" title="이전 페이지">‹</button>
          <span class="page-number-chip">1</span>
          <span class="status-line">/ <span id="bottomPageCount">0</span></span>
          <button class="icon-btn" type="button" title="다음 페이지">›</button>
          <span class="toolbar-separator"></span>
          <button class="icon-btn" id="zoomOutFooter" type="button" title="축소">−</button>
          <span class="zoom-chip" data-zoom-label>100%</span>
          <button class="icon-btn" id="zoomInFooter" type="button" title="확대">+</button>
        </section>
        <button class="keyboard-btn" type="button" title="단축키">⌨</button>
      </footer>
      <div class="toast hidden" id="toast" role="status" aria-live="polite"></div>
    </main>
  `;

  dom.fileInput.type = "file";
  dom.fileInput.accept = "application/pdf";
  dom.fileInput.className = "hidden";
  dom.imageInput.type = "file";
  dom.imageInput.accept = "image/png,image/jpeg,image/webp";
  dom.imageInput.className = "hidden";
  appRoot.append(dom.fileInput, dom.imageInput);

  bindStaticEvents();
  renderToolbar();
  renderDocumentName();
  syncZoomLabels();
  renderWorkspace();
  renderInspector();
}

function bindStaticEvents(): void {
  byId("openButton").addEventListener("click", () => dom.fileInput.click());
  byId("exportButton").addEventListener("click", () => void exportPdf());
  byId("undoButton").addEventListener("click", undo);
  byId("redoButton").addEventListener("click", redo);
  byId("zoomOutButton").addEventListener("click", () => setZoom(zoom - 0.15));
  byId("zoomInButton").addEventListener("click", () => setZoom(zoom + 0.15));
  byId("zoomOutFooter").addEventListener("click", () => setZoom(zoom - 0.15));
  byId("zoomInFooter").addEventListener("click", () => setZoom(zoom + 0.15));

  dom.fileInput.addEventListener("change", () => {
    const file = dom.fileInput.files?.[0];
    if (file) {
      void loadPdf(file);
    }
  });

  dom.imageInput.addEventListener("change", () => {
    const file = dom.imageInput.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        pendingImageDataUrl = reader.result;
        currentTool = "select";
        renderToolbar();
        showToast("이미지가 준비되었습니다. 페이지를 클릭하면 삽입됩니다.");
      }
    });
    reader.readAsDataURL(file);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      clearSelection();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        redo();
      } else {
        undo();
      }
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (selectedId && !isTypingTarget(event.target)) {
        deleteSelected();
      }
    }
  });
}

function renderToolbar(): void {
  const toolbar = byId("toolbar");
  toolbar.innerHTML = "";

  for (const tool of tools) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tool-btn${currentTool === tool.id ? " active" : ""}`;
    button.innerHTML = `<span class="tool-icon">${tool.icon}</span><span>${tool.label}</span>`;
    button.addEventListener("click", () => {
      currentTool = tool.id;
      pendingImageDataUrl = null;
      renderToolbar();
    });
    toolbar.append(button);
  }

  toolbar.append(separator());

  const imageButton = document.createElement("button");
  imageButton.type = "button";
  imageButton.className = "tool-btn";
  imageButton.innerHTML = `<span class="tool-icon">▧</span><span>이미지</span>`;
  imageButton.addEventListener("click", () => dom.imageInput.click());
  toolbar.append(imageButton);

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "검색";
  searchInput.ariaLabel = "PDF 텍스트 검색";
  searchInput.style.minWidth = "120px";
  searchInput.style.height = "36px";
  searchInput.style.border = "1px solid #cfd8e1";
  searchInput.style.borderRadius = "7px";
  searchInput.style.padding = "0 10px";
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      void searchPdf(searchInput.value);
    }
  });
  toolbar.append(searchInput);
}

function separator(): HTMLDivElement {
  const line = document.createElement("div");
  line.className = "toolbar-separator";
  return line;
}

async function loadPdf(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  originalBytes = bytes;
  fileName = file.name.replace(/\.pdf$/i, "") + "-edited.pdf";
  openPassword = "";
  pdfDocument = await openPdfDocument(bytes);
  pageItems = Array.from({ length: pdfDocument.numPages }, (_, index) => ({
    id: crypto.randomUUID(),
    sourceIndex: index,
    rotation: 0,
  }));
  annotations = [];
  deletedSourceAnnotations = [];
  sourceTextItemsByPage = new Map();
  sourceImageItemsByPage = new Map();
  pageCanvasSnapshots = new Map();
  documentMetadata = await readDocumentMetadata(pdfDocument);
  saveMode = "flatten";
  redactionMode = "textOnly";
  selectedId = null;
  currentPageId = pageItems[0]?.id ?? null;
  await cacheSourceTextItems();
  await cacheSourceImageItems(bytes);
  await importExistingAnnotations();
  undoStack = [makeSnapshot()];
  redoStack = [];
  renderDocumentName();
  await renderWorkspace();
  renderInspector();
  showToast(`${file.name} 파일을 열었습니다.`);
}

async function openPdfDocument(bytes: Uint8Array): Promise<pdfjs.PDFDocumentProxy> {
  const loadingTask = pdfjs.getDocument({ data: bytes.slice(), password: openPassword || undefined });
  loadingTask.onPassword = (updatePassword: (password: string) => void, reason: number) => {
    const needsPassword = reason === pdfjs.PasswordResponses.NEED_PASSWORD;
    const promptText = needsPassword
      ? "암호가 걸린 PDF입니다. 암호를 입력하세요."
      : "PDF 암호가 맞지 않습니다. 다시 입력하세요.";
    const password = window.prompt(promptText, "");
    if (password === null) {
      updatePassword("");
      return;
    }
    openPassword = password;
    updatePassword(password);
  };
  try {
    return await loadingTask.promise;
  } catch (error) {
    if (isPasswordError(error)) {
      showToast("PDF 암호가 필요하거나 암호가 올바르지 않습니다.");
    }
    throw error;
  }
}

async function readDocumentMetadata(document: pdfjs.PDFDocumentProxy): Promise<DocumentMetadata> {
  try {
    const raw = await document.getMetadata();
    const info = typeof raw.info === "object" && raw.info !== null
      ? raw.info as Record<string, unknown>
      : {};
    return {
      title: asMetadataString(info.Title),
      author: asMetadataString(info.Author),
      subject: asMetadataString(info.Subject),
      keywords: asMetadataString(info.Keywords),
      creator: asMetadataString(info.Creator) || "PDF Studio",
      producer: asMetadataString(info.Producer) || "PDF Studio Engine",
    };
  } catch {
    return emptyMetadata();
  }
}

function isPasswordError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const name = (error as { name?: unknown }).name;
  return name === "PasswordException";
}

function renderDocumentName(): void {
  const name = byId("documentName");
  name.textContent = originalBytes ? fileName : "문서를 열어주세요";
}

async function renderWorkspace(): Promise<void> {
  const cycle = ++renderCycle;
  const pageList = byId("pageList");
  const pageCount = byId("pageCount");
  const bottomPageCount = document.querySelector<HTMLElement>("#bottomPageCount");
  const canvasArea = byId("canvasArea");
  pageList.innerHTML = "";
  canvasArea.innerHTML = "";

  if (!pdfDocument || !currentPageId) {
    pageCount.textContent = "0";
    if (bottomPageCount) {
      bottomPageCount.textContent = "0";
    }
    canvasArea.innerHTML = `
      <div class="empty-state">
        <div class="empty-card">
          <h1>PDF를 열고 바로 편집하세요</h1>
          <p>텍스트 추가, 형광펜, 박스, 가리기, 자유 펜, 이미지 삽입, 페이지 순서 변경과 삭제를 브라우저 안에서 처리합니다.</p>
          <div class="feature-row">
            <span>로컬 처리</span>
            <span>주석 편집</span>
            <span>페이지 작업</span>
            <span>PDF 내보내기</span>
          </div>
          <button class="action-btn primary" id="emptyOpenButton" type="button">PDF 열기</button>
        </div>
      </div>
    `;
    byId("emptyOpenButton").addEventListener("click", () => dom.fileInput.click());
    return;
  }

  pageCount.textContent = `${pageItems.length}쪽`;
  if (bottomPageCount) {
    bottomPageCount.textContent = `${pageItems.length}`;
  }
  syncZoomLabels();
  for (let index = 0; index < pageItems.length; index += 1) {
    const item = pageItems[index];
    const thumbnail = await renderThumbnail(item, index);
    if (cycle !== renderCycle) {
      return;
    }
    pageList.append(thumbnail);
  }

  const current = currentPage();
  if (!current) {
    return;
  }
  const stage = await renderCurrentPage(current);
  if (cycle !== renderCycle) {
    return;
  }
  canvasArea.append(stage);
}

async function renderThumbnail(item: PageItem, index: number): Promise<HTMLButtonElement> {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `thumb${item.id === currentPageId ? " active" : ""}`;
  button.addEventListener("click", () => {
    currentPageId = item.id;
    selectedId = null;
    void renderWorkspace();
    renderInspector();
  });

  const canvas = document.createElement("canvas");
  const page = await requirePage(item.sourceIndex);
  const viewport = page.getViewport({ scale: 0.18, rotation: item.rotation });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext("2d");
  if (context) {
    await page.render({ canvas, canvasContext: context, viewport }).promise;
  }
  const pageAnnotations = annotations.filter((ann) => ann.pageId === item.id).length;
  button.append(canvas);
  button.insertAdjacentHTML(
    "beforeend",
    `<div class="thumb-meta"><span>${index + 1}쪽</span>${pageAnnotations ? `<span class="badge">${pageAnnotations}</span>` : ""}</div>`,
  );
  return button;
}

async function renderCurrentPage(item: PageItem): Promise<HTMLDivElement> {
  const page = await requirePage(item.sourceIndex);
  const viewport = page.getViewport({ scale: zoom, rotation: item.rotation });
  pageWidth = viewport.width;
  pageHeight = viewport.height;

  const stage = document.createElement("div");
  stage.className = "page-stage";
  const shell = document.createElement("div");
  shell.className = "page-shell";
  shell.style.width = `${pageWidth}px`;
  shell.style.height = `${pageHeight}px`;

  const canvas = document.createElement("canvas");
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(pageWidth * ratio);
  canvas.height = Math.floor(pageHeight * ratio);
  canvas.style.width = `${pageWidth}px`;
  canvas.style.height = `${pageHeight}px`;
  const context = canvas.getContext("2d");
  if (context) {
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    pageCanvasSnapshots.set(item.id, canvas.toDataURL("image/png"));
  }

  const layer = document.createElement("div");
  layer.className = "annotation-layer";
  layer.addEventListener("pointerdown", (event) => handleLayerPointerDown(event, item.id));
  layer.addEventListener("pointermove", handleLayerPointerMove);
  layer.addEventListener("pointerup", handleLayerPointerUp);
  layer.addEventListener("pointercancel", cancelDraft);

  renderLayerContents(layer, item);

  shell.append(canvas, layer);
  stage.append(shell);
  return stage;
}

function renderAnnotation(annotation: Annotation): Element {
  if (annotation.type === "pen") {
    return renderPen(annotation);
  }

  const node = document.createElement("div");
  node.className = `annotation ${annotation.type}${selectedId === annotation.id ? " selected" : ""}`;
  node.style.left = `${annotation.x * pageWidth}px`;
  node.style.top = `${annotation.y * pageHeight}px`;
  node.style.width = `${annotation.width * pageWidth}px`;
  node.style.height = `${annotation.height * pageHeight}px`;
  node.dataset.id = annotation.id;
  node.addEventListener("pointerdown", (event) => handleAnnotationPointerDown(event, annotation));

  if (annotation.type === "formField") {
    renderFormField(annotation, node);
  } else if (annotation.type === "text") {
    node.style.color = annotation.color;
    node.style.fontSize = `${annotation.fontSize * zoom}px`;
    node.style.fontFamily = annotation.fontFamily ?? defaultEditorFontFamily();
    node.style.lineHeight = "1.25";
    if (annotation.sourceTextId) {
      node.classList.add("source-edit");
    }
    if (selectedId === annotation.id && dragState?.id !== annotation.id) {
      const textarea = document.createElement("textarea");
      textarea.value = annotation.text;
      textarea.ariaLabel = "텍스트 편집";
      textarea.style.width = "100%";
      textarea.style.height = "100%";
      textarea.style.border = "0";
      textarea.style.outline = "0";
      textarea.style.resize = "none";
      textarea.style.padding = "0";
      textarea.style.overflow = "hidden";
      textarea.style.background = "transparent";
      textarea.style.color = annotation.color;
      textarea.style.font = "inherit";
      textarea.style.lineHeight = "1.25";
      textarea.addEventListener("pointerdown", (event) => event.stopPropagation());
      textarea.addEventListener("input", () => {
        annotation.text = textarea.value;
        markAnnotationDirty(annotation);
        autoFitText(annotation);
        node.style.height = `${annotation.height * pageHeight}px`;
        textarea.style.height = "100%";
        refreshFlowEffects();
        syncInspectorValues(annotation);
      });
      textarea.addEventListener("blur", commitHistory);
      node.append(textarea);
      requestAnimationFrame(() => textarea.focus());
    } else {
      node.textContent = annotation.text;
    }
  } else if (annotation.type === "image") {
    const img = document.createElement("img");
    img.src = annotation.dataUrl;
    img.alt = "";
    node.append(img);
  } else {
    node.style.background = annotation.type === "rect" ? "transparent" : annotation.color;
    node.style.opacity = `${annotation.opacity}`;
    node.style.borderColor = annotation.type === "rect" ? annotation.color : "transparent";
    node.style.borderWidth = `${Math.max(1, annotation.strokeWidth * zoom)}px`;
  }

  if (selectedId === annotation.id) {
    const handle = document.createElement("div");
    handle.className = "resize-handle";
    handle.addEventListener("pointerdown", (event) => handleResizePointerDown(event, annotation));
    node.append(handle);
  }
  return node;
}

function renderFormField(annotation: FormFieldAnnotation, node: HTMLDivElement): void {
  node.classList.add("form-field", annotation.fieldType === "checkbox" ? "checkbox" : "text-field");
  node.style.borderColor = selectedId === annotation.id ? "#176b58" : "rgba(23, 107, 88, 0.55)";
  node.style.background = "rgba(255, 255, 255, 0.72)";
  if (annotation.fieldType === "checkbox") {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(annotation.checked);
    checkbox.ariaLabel = annotation.fieldName;
    checkbox.addEventListener("pointerdown", (event) => event.stopPropagation());
    checkbox.addEventListener("change", () => {
      annotation.checked = checkbox.checked;
      annotation.fieldValue = checkbox.checked ? annotation.exportValue ?? "Yes" : "Off";
      markAnnotationDirty(annotation);
      commitHistory();
      renderInspector();
      renderCurrentLayer();
    });
    node.append(checkbox);
    return;
  }

  const input = document.createElement("input");
  input.type = "text";
  input.value = annotation.fieldValue;
  input.ariaLabel = annotation.fieldName;
  input.addEventListener("pointerdown", (event) => event.stopPropagation());
  input.addEventListener("input", () => {
    annotation.fieldValue = input.value;
    markAnnotationDirty(annotation);
    syncInspectorValues(annotation);
  });
  input.addEventListener("blur", commitHistory);
  node.append(input);
}

function renderPen(annotation: PenAnnotation): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("pen-stroke");
  if (selectedId === annotation.id) {
    svg.classList.add("selected");
  }
  svg.setAttribute("width", `${pageWidth}`);
  svg.setAttribute("height", `${pageHeight}`);
  svg.dataset.id = annotation.id;
  svg.addEventListener("pointerdown", (event) => handleAnnotationPointerDown(event, annotation));

  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute(
    "points",
    annotation.points
      .map((point) => `${point.x * pageWidth},${point.y * pageHeight}`)
      .join(" "),
  );
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", annotation.color);
  polyline.setAttribute("stroke-width", `${annotation.strokeWidth * zoom}`);
  polyline.setAttribute("stroke-linecap", "round");
  polyline.setAttribute("stroke-linejoin", "round");
  svg.append(polyline);
  return svg;
}

function handleLayerPointerDown(event: PointerEvent, pageId: string): void {
  if (!(event.currentTarget instanceof HTMLElement)) {
    return;
  }
  const point = eventPoint(event, event.currentTarget);

  if (pendingImageDataUrl) {
    addImage(pageId, point.x, point.y, pendingImageDataUrl);
    pendingImageDataUrl = null;
    return;
  }

  if (currentTool === "select") {
    selectedId = null;
    renderInspector();
    renderCurrentLayer();
    return;
  }

  if (currentTool === "text") {
    addText(pageId, point.x, point.y);
    return;
  }

  if (currentTool === "pen") {
    draftState = {
      type: "pen",
      tool: "pen",
      startX: point.x,
      startY: point.y,
      points: [toRelativePoint(point.x, point.y)],
    };
    return;
  }

  draftState = {
    type: "box",
    tool: currentTool,
    startX: point.x,
    startY: point.y,
    points: [],
  };
}

function renderSourceTextItem(item: SourceTextItem): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `source-text${item.lineCount > 1 ? " block" : ""}`;
  button.textContent = item.text;
  button.ariaLabel = `기존 PDF 글씨 편집: ${item.text}`;
  button.style.left = `${item.x * pageWidth}px`;
  button.style.top = `${item.y * pageHeight}px`;
  button.style.width = `${item.width * pageWidth}px`;
  button.style.height = `${item.height * pageHeight}px`;
  button.style.fontSize = `${item.fontSize * zoom}px`;
  button.style.fontFamily = item.fontFamily;
  button.title = "기존 PDF 글씨 편집";
  button.addEventListener("pointerdown", (event) => {
    if (currentTool !== "select") {
      return;
    }
    event.stopPropagation();
    convertSourceTextToAnnotation(item);
  });
  return button;
}

function renderSourceImageItem(item: SourceImageItem): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "source-image";
  button.ariaLabel = "기존 PDF 이미지 삭제 대상으로 선택";
  button.style.left = `${item.x * pageWidth}px`;
  button.style.top = `${item.y * pageHeight}px`;
  button.style.width = `${item.width * pageWidth}px`;
  button.style.height = `${item.height * pageHeight}px`;
  button.title = "기존 PDF 이미지 삭제";
  button.addEventListener("pointerdown", (event) => {
    if (currentTool !== "select") {
      return;
    }
    event.stopPropagation();
    convertSourceImageToRedaction(item);
  });
  return button;
}

function renderCurrentLayer(): void {
  const item = currentPage();
  const layer = document.querySelector<HTMLElement>(".annotation-layer");
  if (!item || !layer) {
    return;
  }
  renderLayerContents(layer, item);
}

function refreshFlowEffects(): void {
  const item = currentPage();
  const layer = document.querySelector<HTMLElement>(".annotation-layer");
  if (!item || !layer) {
    return;
  }
  layer.querySelectorAll(".source-mask, .source-text, .source-image, .flow-slice").forEach((node) => node.remove());
  const flowSlices = pageFlowSlicesForPage(item.id);
  const flowNodes = [
    ...sourceMasksForPage(item.id).map(renderSourceMask),
    ...flowSlices.map(renderPageFlowSlice),
    ...(flowSlices.length > 0 ? [] : flowedSourceTextsForPage(item.id).map(renderFlowedSourceText)),
    ...(sourceImageItemsByPage.get(item.id) ?? [])
      .filter((sourceImage) => !isSourceImageAlreadyEdited(sourceImage.id))
      .map(renderSourceImageItem),
    ...(sourceTextItemsByPage.get(item.id) ?? [])
      .filter((sourceText) => !isSourceTextAlreadyEdited(sourceText.id) && sourceTextFlowOffset(sourceText) === 0)
      .map(renderSourceTextItem),
  ];
  layer.prepend(...flowNodes);
}

function syncInspectorValues(annotation: Annotation): void {
  const boxHeight = document.querySelector<HTMLInputElement>("#boxHeight");
  if (boxHeight) {
    boxHeight.value = `${Math.round(annotation.height * 100)}`;
  }
  if (annotation.type !== "text") {
    if (annotation.type === "formField") {
      const formValue = document.querySelector<HTMLInputElement>("#formValue");
      if (formValue && document.activeElement !== formValue) {
        formValue.value = annotation.fieldValue;
      }
      const formChecked = document.querySelector<HTMLInputElement>("#formChecked");
      if (formChecked) {
        formChecked.checked = Boolean(annotation.checked);
      }
    }
    return;
  }
  const textValue = document.querySelector<HTMLTextAreaElement>("#textValue");
  if (textValue && document.activeElement !== textValue) {
    textValue.value = annotation.text;
  }
}

function renderLayerContents(layer: HTMLElement, item: PageItem): void {
  layer.innerHTML = "";
  const flowSlices = pageFlowSlicesForPage(item.id);
  for (const mask of sourceMasksForPage(item.id)) {
    layer.append(renderSourceMask(mask));
  }

  for (const slice of flowSlices) {
    layer.append(renderPageFlowSlice(slice));
  }

  if (flowSlices.length === 0) {
    for (const flowedText of flowedSourceTextsForPage(item.id)) {
      layer.append(renderFlowedSourceText(flowedText));
    }
  }

  for (const sourceText of sourceTextItemsByPage.get(item.id) ?? []) {
    if (!isSourceTextAlreadyEdited(sourceText.id) && sourceTextFlowOffset(sourceText) === 0) {
      layer.append(renderSourceTextItem(sourceText));
    }
  }

  for (const sourceImage of sourceImageItemsByPage.get(item.id) ?? []) {
    if (!isSourceImageAlreadyEdited(sourceImage.id)) {
      layer.append(renderSourceImageItem(sourceImage));
    }
  }

  for (const annotation of annotations.filter((ann) => ann.pageId === item.id)) {
    layer.append(renderAnnotation(annotation));
  }
}

function renderSourceMask(mask: SourceMask): HTMLDivElement {
  const element = document.createElement("div");
  element.className = "source-mask";
  element.dataset.id = mask.id;
  element.style.left = `${mask.x * pageWidth}px`;
  element.style.top = `${mask.y * pageHeight}px`;
  element.style.width = `${mask.width * pageWidth}px`;
  element.style.height = `${mask.height * pageHeight}px`;
  return element;
}

function renderPageFlowSlice(slice: PageFlowSlice): HTMLDivElement {
  const element = document.createElement("div");
  element.className = "flow-slice";
  element.dataset.id = slice.id;
  element.style.left = `${slice.x * pageWidth}px`;
  element.style.top = `${slice.y * pageHeight}px`;
  element.style.width = `${slice.width * pageWidth}px`;
  element.style.height = `${slice.height * pageHeight}px`;
  element.style.backgroundImage = `url("${pageCanvasSnapshots.get(slice.pageId) ?? ""}")`;
  element.style.backgroundSize = `${pageWidth}px ${pageHeight}px`;
  element.style.backgroundPosition = `-${slice.x * pageWidth}px -${slice.sourceY * pageHeight}px`;
  return element;
}

function renderFlowedSourceText(flowedText: FlowedSourceText): HTMLButtonElement {
  const item = flowedText.item;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `source-text flowed-source-text${item.lineCount > 1 ? " block" : ""}`;
  button.textContent = item.text;
  button.ariaLabel = `재배치된 PDF 글씨 편집: ${item.text}`;
  button.style.left = `${item.x * pageWidth}px`;
  button.style.top = `${flowedText.y * pageHeight}px`;
  button.style.width = `${item.width * pageWidth}px`;
  button.style.height = `${item.height * pageHeight}px`;
  button.style.fontSize = `${item.fontSize * zoom}px`;
  button.style.fontFamily = item.fontFamily;
  button.title = "재배치된 기존 PDF 글씨 편집";
  button.addEventListener("pointerdown", (event) => {
    if (currentTool !== "select") {
      return;
    }
    event.stopPropagation();
    convertSourceTextToAnnotation(item);
  });
  return button;
}

function sourceMasksForPage(pageId: string): SourceMask[] {
  const masks: SourceMask[] = [];
  for (const annotation of sourceEditAnnotations(pageId)) {
    if (annotation.eraseOriginal) {
      masks.push({
        id: `${annotation.id}:original`,
        ...annotation.eraseOriginal,
      });
    }
  }

  for (const sourceText of sourceTextItemsByPage.get(pageId) ?? []) {
    if (isSourceTextAlreadyEdited(sourceText.id)) {
      continue;
    }
    if (sourceTextFlowOffset(sourceText) !== 0) {
      masks.push({
        id: `${sourceText.id}:flow-mask`,
        x: sourceText.x,
        y: sourceText.y,
        width: sourceText.width,
        height: sourceText.height,
      });
    }
  }

  for (const slice of layoutFlowSlicesForPage(pageId)) {
    masks.push({
      id: `${slice.id}:source`,
      x: slice.x,
      y: slice.sourceY,
      width: slice.width,
      height: 1 - slice.sourceY,
    });
  }

  return mergeMasks(masks);
}

function pageFlowSlicesForPage(pageId: string): PageFlowSlice[] {
  if (!pageCanvasSnapshots.has(pageId)) {
    return [];
  }
  return layoutFlowSlicesForPage(pageId);
}

function layoutFlowSlicesForPage(pageId: string): PageFlowSlice[] {
  return sourceEditAnnotations(pageId).flatMap((annotation) => {
    const original = annotation.eraseOriginal;
    if (!original || !isReflowSourceAnnotation(annotation)) {
      return [];
    }
    const delta = annotation.height - original.height;
    if (Math.abs(delta) < 0.002) {
      return [];
    }
    const sourceY = clamp(original.y + original.height, 0, 1);
    const y = clamp(sourceY + delta, 0, 1);
    const isPageFlow = original.width >= 0.32;
    const x = isPageFlow ? 0 : clamp(original.x - 0.02, 0, 1);
    const right = isPageFlow ? 1 : clamp(original.x + original.width + 0.02, 0, 1);
    const height = Math.max(0, Math.min(1 - sourceY, 1 - y));
    if (height <= 0) {
      return [];
    }
    return [
      {
        id: `${annotation.id}:flow-slice`,
        pageId,
        x,
        sourceY,
        y,
        width: right - x,
        height,
      },
    ];
  });
}

function flowedSourceTextsForPage(pageId: string): FlowedSourceText[] {
  return (sourceTextItemsByPage.get(pageId) ?? []).flatMap((item) => {
    if (isSourceTextAlreadyEdited(item.id)) {
      return [];
    }
    const offset = sourceTextFlowOffset(item);
    if (offset === 0) {
      return [];
    }
    return [
      {
        id: `${item.id}:flowed`,
        item,
        y: clamp(item.y + offset, 0, 1 - item.height),
      },
    ];
  });
}

function sourceEditAnnotations(pageId: string): TextAnnotation[] {
  return sourceEditAnnotationsInDocument().filter((annotation) => annotation.pageId === pageId);
}

function sourceEditAnnotationsInDocument(): TextAnnotation[] {
  const pageOrder = new Map(pageItems.map((item, index) => [item.id, index]));
  return annotations
    .filter(
      (annotation): annotation is TextAnnotation =>
        annotation.type === "text" &&
        Boolean(annotation.sourceTextId) &&
        Boolean(annotation.eraseOriginal),
    )
    .sort((left, right) => {
      const pageDelta = (pageOrder.get(left.pageId) ?? 0) - (pageOrder.get(right.pageId) ?? 0);
      return pageDelta || left.y - right.y;
    });
}

function sourceTextFlowOffset(sourceText: SourceTextItem): number {
  if (!sourceText.reflowable) {
    return 0;
  }
  const sourcePageIndex = pageItems.findIndex((item) => item.id === sourceText.pageId);
  if (sourcePageIndex < 0) {
    return 0;
  }
  let offset = 0;
  for (const annotation of sourceEditAnnotationsInDocument()) {
    if (!annotation.eraseOriginal || annotation.sourceTextId === sourceText.id) {
      continue;
    }
    const annotationPageIndex = pageItems.findIndex((item) => item.id === annotation.pageId);
    const delta = annotation.height - annotation.eraseOriginal.height;
    if (annotationPageIndex >= 0 && annotationPageIndex < sourcePageIndex) {
      offset += Math.max(0, delta);
    } else if (annotation.pageId === sourceText.pageId && isBelowSameFlow(sourceText, annotation)) {
      offset += annotation.height - annotation.eraseOriginal.height;
    }
  }
  return Math.abs(offset) < 0.002 ? 0 : offset;
}

function isBelowSameFlow(sourceText: SourceTextItem, annotation: TextAnnotation): boolean {
  const original = annotation.eraseOriginal;
  if (!original || !sourceText.reflowable || !isReflowSourceAnnotation(annotation)) {
    return false;
  }
  const originalBottom = original.y + original.height;
  if (sourceText.y < originalBottom - Math.max(sourceText.height, original.height) * 0.2) {
    return false;
  }
  const overlap = horizontalOverlapRatio(sourceText, original);
  if (overlap < 0.35) {
    return false;
  }
  const leftTolerance = Math.max(0.025, original.width * 0.12);
  const sameColumnLeft = Math.abs(sourceText.x - original.x) <= leftTolerance;
  const sourceInsideOriginalColumn =
    sourceText.x >= original.x - leftTolerance &&
    sourceText.x + sourceText.width <= original.x + original.width + leftTolerance;
  return sameColumnLeft || sourceInsideOriginalColumn;
}

function isReflowSourceAnnotation(annotation: TextAnnotation): boolean {
  if (annotation.reflowable !== undefined) {
    return annotation.reflowable;
  }
  if (!annotation.sourceTextId) {
    return false;
  }
  return sourceTextItemsByPage
    .get(annotation.pageId)
    ?.some((sourceText) => sourceText.id === annotation.sourceTextId && sourceText.reflowable) ?? false;
}

function horizontalOverlapRatio(
  left: { x: number; width: number },
  right: { x: number; width: number },
): number {
  const overlap = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  return overlap / Math.max(0.001, Math.min(left.width, right.width));
}

function mergeMasks(masks: SourceMask[]): SourceMask[] {
  const merged: SourceMask[] = [];
  for (const mask of masks.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      Math.abs(previous.x - mask.x) < 0.01 &&
      Math.abs(previous.width - mask.width) < 0.02 &&
      mask.y <= previous.y + previous.height + 0.005
    ) {
      const bottom = Math.max(previous.y + previous.height, mask.y + mask.height);
      previous.y = Math.min(previous.y, mask.y);
      previous.height = bottom - previous.y;
    } else {
      merged.push({ ...mask });
    }
  }
  return merged;
}

function convertSourceTextToAnnotation(item: SourceTextItem): void {
  const existing = annotations.find(
    (annotation) => annotation.type === "text" && annotation.sourceTextId === item.id,
  );
  if (existing) {
    selectedId = existing.id;
    renderInspector();
    renderCurrentLayer();
    return;
  }

  const annotation: TextAnnotation = {
    id: crypto.randomUUID(),
    pageId: item.pageId,
    type: "text",
    x: item.x,
    y: item.y,
    width: clamp(item.width, 0.02, 1 - item.x),
    height: clamp(item.height, 0.02, 1 - item.y),
    color: "#172026",
    opacity: 1,
    strokeWidth: 1,
    text: item.text,
    fontSize: Math.round(item.fontSize),
    fontFamily: item.fontFamily,
    fontName: item.fontName,
    reflowable: item.reflowable,
    sourceTextId: item.id,
    eraseOriginal: {
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    },
  };
  autoFitText(annotation);
  annotations.push(annotation);
  selectedId = annotation.id;
  commitHistory();
  renderInspector();
  renderCurrentLayer();
}

async function cacheSourceTextItems(): Promise<void> {
  if (!pdfDocument) {
    return;
  }

  for (const pageItem of pageItems) {
    const page = await requirePage(pageItem.sourceIndex);
    const viewport = page.getViewport({ scale: 1, rotation: pageItem.rotation });
    const content = await page.getTextContent();
    const styles = content.styles as Record<string, PdfTextStyle>;
    const sourceItems: SourceTextItem[] = [];

    for (const rawItem of content.items) {
      if (!isPdfTextItem(rawItem)) {
        continue;
      }
      if (!isNumberArray(viewport.transform, 6)) {
        continue;
      }
      const text = rawItem.str.trim();
      if (!text) {
        continue;
      }
      const matrix = multiplyMatrix(viewport.transform, rawItem.transform);
      const fontSize = Math.max(8, Math.hypot(matrix[2], matrix[3]));
      const style = styles[rawItem.fontName];
      const fontFamily = normalizePdfFontFamily(style?.fontFamily ?? rawItem.fontName);
      const reflowable = isMostlyHorizontalText(matrix);
      const left = matrix[4];
      const top = matrix[5] - fontSize;
      const width = Math.max(rawItem.width, fontSize * text.length * 0.45);
      const height = Math.max(rawItem.height, fontSize);
      sourceItems.push({
        id: `${pageItem.id}:${sourceItems.length}`,
        pageId: pageItem.id,
        text,
        x: clamp(left / viewport.width, 0, 0.98),
        y: clamp(top / viewport.height, 0, 0.98),
        width: clamp(width / viewport.width, 0.015, 1),
        height: clamp(height / viewport.height, 0.012, 1),
        fontSize,
        fontFamily,
        fontName: rawItem.fontName,
        lineCount: 1,
        reflowable,
      });
    }

    sourceTextItemsByPage.set(pageItem.id, mergeTextItemsIntoBlocks(sourceItems));
  }
}

async function cacheSourceImageItems(bytes: Uint8Array): Promise<void> {
  sourceImageItemsByPage = new Map();
  const endpoints = buildEngineEndpoints("/api/pdf/extract");
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          pdfBase64: bytesToBase64(bytes),
          password: openPassword || undefined,
        }),
      });
      if (!response.ok) {
        continue;
      }
      const result: unknown = await response.json();
      if (!isEngineExtractResponse(result)) {
        continue;
      }
      const pagesByIndex = new Map(result.pages.map((page) => [page.index, page]));
      for (const pageItem of pageItems) {
        const page = pagesByIndex.get(pageItem.sourceIndex);
        const images = page?.images ?? [];
        sourceImageItemsByPage.set(
          pageItem.id,
          images.map((image, index) => ({
            id: `${pageItem.id}:image-${index}`,
            pageId: pageItem.id,
            sourceImageId: image.id,
            x: clamp(image.x, 0, 0.999),
            y: clamp(image.y, 0, 0.999),
            width: clamp(image.width, 0.001, 1),
            height: clamp(image.height, 0.001, 1),
          })),
        );
      }
      return;
    } catch (error) {
      console.warn(`PDF engine image extraction failed at ${endpoint}`, error);
    }
  }
}

async function importExistingAnnotations(): Promise<void> {
  if (!pdfDocument) {
    return;
  }

  const imported: Annotation[] = [];
  for (const pageItem of pageItems) {
    const page = await requirePage(pageItem.sourceIndex);
    const viewport = page.getViewport({ scale: 1, rotation: pageItem.rotation });
    const rawAnnotations = await page.getAnnotations({ intent: "display" });
    rawAnnotations.forEach((rawAnnotation: unknown, index: number) => {
      const annotation = convertPdfAnnotation(rawAnnotation, pageItem.id, viewport, index);
      if (annotation) {
        imported.push(annotation);
      }
    });
  }
  annotations.push(...imported);
}

function convertPdfAnnotation(
  rawAnnotation: unknown,
  pageId: string,
  viewport: PdfPageViewport,
  index: number,
): Annotation | null {
  if (typeof rawAnnotation !== "object" || rawAnnotation === null) {
    return null;
  }
  const raw = rawAnnotation as Record<string, unknown>;
  const subtype = String(raw.subtype ?? "");
  const rect = annotationRect(raw.rect, viewport);
  if (!rect) {
    return null;
  }
  const sourceAnnotationId = String(raw.id ?? `${pageId}:annotation-${index}`);
  const base = {
    id: crypto.randomUUID(),
    pageId,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    color: annotationColor(raw.color, subtype),
    opacity: 0.45,
    strokeWidth: annotationStrokeWidth(raw.borderStyle),
    sourceAnnotationId,
    sourceAnnotationSubtype: subtype,
    dirty: false,
  };

  if (subtype === "Widget") {
    return convertWidgetAnnotation(raw, base);
  }

  if (subtype === "FreeText") {
    return {
      ...base,
      type: "text",
      text: annotationText(raw),
      fontSize: 14,
      fontFamily: defaultEditorFontFamily(),
      reflowable: false,
    };
  }

  if (subtype === "Highlight" || subtype === "Underline" || subtype === "StrikeOut" || subtype === "Squiggly") {
    return {
      ...base,
      type: "highlight",
      opacity: 0.35,
    };
  }

  if (subtype === "Square") {
    return {
      ...base,
      type: "rect",
      opacity: 1,
    };
  }

  if (subtype === "Ink") {
    const points = annotationInkPoints(raw.inkLists, viewport);
    if (points.length < 2) {
      return null;
    }
    return {
      ...base,
      type: "pen",
      points,
      opacity: 1,
    };
  }

  return null;
}

function convertWidgetAnnotation(
  raw: Record<string, unknown>,
  base: Omit<FormFieldAnnotation, "type" | "fieldName" | "fieldType" | "fieldValue" | "checked" | "exportValue">,
): FormFieldAnnotation | null {
  const fieldName = String(raw.fieldName ?? base.sourceAnnotationId ?? "");
  if (!fieldName) {
    return null;
  }
  const fieldType = String(raw.fieldType ?? "");
  if (fieldType === "Tx") {
    return {
      ...base,
      type: "formField",
      fieldName,
      fieldType: "text",
      fieldValue: annotationText(raw),
      opacity: 1,
      strokeWidth: base.strokeWidth || 1,
    };
  }
  if (fieldType === "Btn" && raw.checkBox === true) {
    const exportValue = String(raw.exportValue ?? "Yes");
    const fieldValue = String(raw.fieldValue ?? "");
    return {
      ...base,
      type: "formField",
      fieldName,
      fieldType: "checkbox",
      fieldValue,
      checked: fieldValue !== "" && fieldValue !== "Off",
      exportValue,
      opacity: 1,
      strokeWidth: base.strokeWidth || 1,
    };
  }
  return null;
}

function annotationRect(rawRect: unknown, viewport: PdfPageViewport): NormalizedRect | null {
  if (!Array.isArray(rawRect) || rawRect.length !== 4 || rawRect.some((value) => typeof value !== "number")) {
    return null;
  }
  const converted = viewport.convertToViewportRectangle(rawRect as [number, number, number, number]);
  const left = Math.min(converted[0], converted[2]);
  const top = Math.min(converted[1], converted[3]);
  const right = Math.max(converted[0], converted[2]);
  const bottom = Math.max(converted[1], converted[3]);
  return {
    x: clamp(left / viewport.width, 0, 1),
    y: clamp(top / viewport.height, 0, 1),
    width: clamp((right - left) / viewport.width, 0.005, 1),
    height: clamp((bottom - top) / viewport.height, 0.005, 1),
  };
}

function annotationText(raw: Record<string, unknown>): string {
  for (const key of ["contents", "fieldValue", "title"]) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

function annotationColor(value: unknown, subtype: string): string {
  if (Array.isArray(value) && value.length >= 3 && value.every((entry) => typeof entry === "number")) {
    return `#${value.slice(0, 3).map((entry) => clamp(Math.round(Number(entry)), 0, 255).toString(16).padStart(2, "0")).join("")}`;
  }
  if (ArrayBuffer.isView(value) && typeof (value as { length?: unknown }).length === "number") {
    const channels = Array.from(value as unknown as ArrayLike<number>);
    if (channels.length < 3) {
      return subtype === "Highlight" ? "#ffe45c" : "#176b58";
    }
    return `#${channels
      .slice(0, 3)
      .map((entry) => clamp(Math.round(Number(entry)), 0, 255).toString(16).padStart(2, "0"))
      .join("")}`;
  }
  if (subtype === "Highlight") {
    return "#ffe45c";
  }
  return "#176b58";
}

function annotationStrokeWidth(value: unknown): number {
  if (typeof value === "object" && value !== null) {
    const width = (value as { width?: unknown }).width;
    if (typeof width === "number" && Number.isFinite(width)) {
      return clamp(width, 1, 12);
    }
  }
  return 2;
}

function annotationInkPoints(value: unknown, viewport: PdfPageViewport): Point[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const firstPath = value.find((entry) => Array.isArray(entry));
  if (!Array.isArray(firstPath)) {
    return [];
  }
  const points: Point[] = [];
  for (const rawPoint of firstPath) {
    if (Array.isArray(rawPoint) && rawPoint.length >= 2) {
      const [x, y] = viewport.convertToViewportPoint(Number(rawPoint[0]), Number(rawPoint[1]));
      points.push({ x: clamp(x / viewport.width, 0, 1), y: clamp(y / viewport.height, 0, 1) });
    } else if (typeof rawPoint === "object" && rawPoint !== null) {
      const candidate = rawPoint as { x?: unknown; y?: unknown };
      if (typeof candidate.x === "number" && typeof candidate.y === "number") {
        const [x, y] = viewport.convertToViewportPoint(candidate.x, candidate.y);
        points.push({ x: clamp(x / viewport.width, 0, 1), y: clamp(y / viewport.height, 0, 1) });
      }
    }
  }
  return points;
}

function mergeTextItemsIntoBlocks(items: SourceTextItem[]): SourceTextItem[] {
  const lines = mergeTextItemsIntoLines(items);
  return mergeLinesIntoBlocks(lines);
}

function mergeTextItemsIntoLines(items: SourceTextItem[]): SourceTextItem[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: SourceTextItem[][] = [];

  for (const item of sorted) {
    const row = rows.find((candidate) => {
      const first = candidate[0];
      return (
        first.reflowable === item.reflowable &&
        Math.abs(first.y - item.y) < Math.max(first.height, item.height) * 0.65
      );
    });
    if (row) {
      row.push(item);
    } else {
      rows.push([item]);
    }
  }

  return rows.flatMap((row, rowIndex) => {
    const ordered = row.sort((a, b) => a.x - b.x);
    const merged: SourceTextItem[] = [];
    for (const item of ordered) {
      const previous = merged[merged.length - 1];
      const gap = previous ? item.x - (previous.x + previous.width) : 0;
      if (
        previous &&
        previous.reflowable === item.reflowable &&
        gap >= 0 &&
        gap < Math.max(previous.height, item.height) * 0.9
      ) {
        const right = Math.max(previous.x + previous.width, item.x + item.width);
        const bottom = Math.max(previous.y + previous.height, item.y + item.height);
        previous.text = `${previous.text}${needsSpaceBetween(previous.text, item.text) ? " " : ""}${item.text}`;
        previous.y = Math.min(previous.y, item.y);
        previous.width = right - previous.x;
        previous.height = bottom - previous.y;
        previous.fontSize = Math.max(previous.fontSize, item.fontSize);
        previous.lineCount = 1;
      } else {
        merged.push({ ...item, id: `${item.pageId}:line-${rowIndex}-${merged.length}`, lineCount: 1 });
      }
    }
    return merged;
  });
}

function mergeLinesIntoBlocks(lines: SourceTextItem[]): SourceTextItem[] {
  const blocks: SourceTextItem[] = [];
  const ordered = [...lines].sort((a, b) => a.y - b.y || a.x - b.x);

  for (const line of ordered) {
    const previous = blocks[blocks.length - 1];
    if (previous && shouldMergeLineIntoBlock(previous, line)) {
      const right = Math.max(previous.x + previous.width, line.x + line.width);
      const bottom = Math.max(previous.y + previous.height, line.y + line.height);
      previous.text = `${previous.text}\n${line.text}`;
      previous.x = Math.min(previous.x, line.x);
      previous.y = Math.min(previous.y, line.y);
      previous.width = right - previous.x;
      previous.height = bottom - previous.y;
      previous.fontSize = weightedFontSize(previous, line);
      previous.lineCount += 1;
    } else {
      blocks.push({
        ...line,
        id: `${line.pageId}:block-${blocks.length}`,
      });
    }
  }

  return blocks;
}

function shouldMergeLineIntoBlock(block: SourceTextItem, line: SourceTextItem): boolean {
  if (!block.reflowable || !line.reflowable) {
    return false;
  }
  if (block.fontFamily !== line.fontFamily) {
    return false;
  }
  const fontDelta = Math.abs(block.fontSize - line.fontSize);
  if (fontDelta > Math.max(0.75, block.fontSize * 0.1)) {
    return false;
  }
  const blockBottom = block.y + block.height;
  const verticalGap = line.y - blockBottom;
  if (verticalGap < -block.height * 0.4 || verticalGap > Math.max(block.height, line.height) * 0.9) {
    return false;
  }
  const xDelta = Math.abs(line.x - block.x);
  const compatibleIndent = xDelta < Math.max(0.035, block.height * 2.4);
  const overlappingColumn = line.x < block.x + block.width && block.x < line.x + line.width;
  return compatibleIndent || overlappingColumn;
}

function weightedFontSize(block: SourceTextItem, line: SourceTextItem): number {
  const totalLines = block.lineCount + 1;
  return (block.fontSize * block.lineCount + line.fontSize) / totalLines;
}

function needsSpaceBetween(left: string, right: string): boolean {
  if (!left || !right) {
    return false;
  }
  return /[A-Za-z0-9)]$/.test(left) && /^[A-Za-z0-9(]/.test(right);
}

function isSourceTextAlreadyEdited(sourceTextId: string): boolean {
  return annotations.some(
    (annotation) => annotation.type === "text" && annotation.sourceTextId === sourceTextId,
  );
}

function isSourceImageAlreadyEdited(sourceImageItemId: string): boolean {
  return annotations.some(
    (annotation) => annotation.sourceImageId === sourceImageItemId,
  );
}

function pageHasSourceTextEdit(pageId: string): boolean {
  return annotations.some(
    (annotation) => annotation.pageId === pageId && annotation.type === "text" && Boolean(annotation.sourceTextId),
  );
}

function sourceTextToAnnotation(sourceText: SourceTextItem): TextAnnotation {
  const edited = annotations.find(
    (annotation): annotation is TextAnnotation =>
      annotation.type === "text" && annotation.sourceTextId === sourceText.id,
  );
  if (edited) {
    return edited;
  }
  return {
    id: sourceText.id,
    pageId: sourceText.pageId,
    type: "text",
    x: sourceText.x,
    y: sourceText.y,
    width: sourceText.width,
    height: sourceText.height,
    color: "#172026",
    opacity: 1,
    strokeWidth: 1,
    text: sourceText.text,
    fontSize: sourceText.fontSize,
    fontFamily: sourceText.fontFamily,
    fontName: sourceText.fontName,
    reflowable: sourceText.reflowable,
    sourceTextId: sourceText.id,
  };
}

function convertSourceImageToRedaction(item: SourceImageItem): void {
  if (isSourceImageAlreadyEdited(item.id)) {
    return;
  }
  const annotation: BoxAnnotation = {
    id: crypto.randomUUID(),
    pageId: item.pageId,
    type: "redact",
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    color: "#ffffff",
    opacity: 1,
    strokeWidth: 1,
    sourceImageId: item.id,
    dirty: true,
  };
  annotations.push(annotation);
  selectedId = annotation.id;
  commitHistory();
  renderInspector();
  renderCurrentLayer();
}

function handleLayerPointerMove(event: PointerEvent): void {
  if (dragState) {
    updateDrag(event);
    return;
  }
  if (!draftState || !(event.currentTarget instanceof HTMLElement)) {
    return;
  }
  if (draftState.type === "pen") {
    const point = eventPoint(event, event.currentTarget);
    draftState.points.push(toRelativePoint(point.x, point.y));
  }
}

function handleLayerPointerUp(event: PointerEvent): void {
  if (dragState) {
    finishDrag();
    return;
  }
  if (!draftState || !(event.currentTarget instanceof HTMLElement) || !currentPageId) {
    return;
  }
  const point = eventPoint(event, event.currentTarget);
  const draft = draftState;
  draftState = null;

  if (draft.type === "pen") {
    if (draft.points.length < 2) {
      return;
    }
    const annotation: PenAnnotation = {
      id: crypto.randomUUID(),
      pageId: currentPageId,
      type: "pen",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      color: "#d8342a",
      opacity: 1,
      strokeWidth: 3,
      points: draft.points,
    };
    annotations.push(annotation);
    selectedId = annotation.id;
    commitHistory();
    renderInspector();
    renderCurrentLayer();
    return;
  }

  const left = Math.min(draft.startX, point.x);
  const top = Math.min(draft.startY, point.y);
  const width = Math.max(18, Math.abs(point.x - draft.startX));
  const height = Math.max(18, Math.abs(point.y - draft.startY));
  addBox(
    currentPageId,
    draft.tool as Extract<Tool, "highlight" | "rect" | "redact">,
    left,
    top,
    width,
    height,
  );
}

function cancelDraft(): void {
  draftState = null;
  dragState = null;
}

function addText(pageId: string, x: number, y: number): void {
  const annotation: TextAnnotation = {
    id: crypto.randomUUID(),
    pageId,
    type: "text",
    x: clamp(x / pageWidth, 0, 0.92),
    y: clamp(y / pageHeight, 0, 0.94),
    width: 0.24,
    height: 0.06,
    color: "#172026",
    opacity: 1,
    strokeWidth: 1,
    text: "텍스트",
    fontSize: 18,
  };
  autoFitText(annotation);
  annotations.push(annotation);
  selectedId = annotation.id;
  commitHistory();
  renderInspector();
  renderCurrentLayer();
}

function addImage(pageId: string, x: number, y: number, dataUrl: string): void {
  const annotation: ImageAnnotation = {
    id: crypto.randomUUID(),
    pageId,
    type: "image",
    x: clamp(x / pageWidth, 0, 0.75),
    y: clamp(y / pageHeight, 0, 0.75),
    width: 0.24,
    height: 0.16,
    color: "#172026",
    opacity: 1,
    strokeWidth: 1,
    dataUrl,
  };
  annotations.push(annotation);
  selectedId = annotation.id;
  commitHistory();
  renderInspector();
  renderCurrentLayer();
}

function addBox(
  pageId: string,
  tool: Extract<Tool, "highlight" | "rect" | "redact">,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const annotation: BoxAnnotation = {
    id: crypto.randomUUID(),
    pageId,
    type: tool,
    x: clamp(x / pageWidth, 0, 0.98),
    y: clamp(y / pageHeight, 0, 0.98),
    width: clamp(width / pageWidth, 0.02, 1),
    height: clamp(height / pageHeight, 0.02, 1),
    color:
      tool === "highlight" ? "#ffe45c" : tool === "redact" ? "#ffffff" : "#176b58",
    opacity: tool === "highlight" ? 0.5 : 1,
    strokeWidth: tool === "rect" ? 2 : 0,
  };
  annotations.push(annotation);
  selectedId = annotation.id;
  commitHistory();
  renderInspector();
  renderCurrentLayer();
}

function handleAnnotationPointerDown(event: PointerEvent, annotation: Annotation): void {
  if (currentTool !== "select") {
    return;
  }
  event.stopPropagation();
  selectedId = annotation.id;
  dragState = {
    id: annotation.id,
    mode: "move",
    startX: event.clientX,
    startY: event.clientY,
    original: cloneAnnotation(annotation),
  };
  renderInspector();
  renderCurrentLayer();
}

function handleResizePointerDown(event: PointerEvent, annotation: Annotation): void {
  event.stopPropagation();
  selectedId = annotation.id;
  dragState = {
    id: annotation.id,
    mode: "resize",
    startX: event.clientX,
    startY: event.clientY,
    original: cloneAnnotation(annotation),
  };
}

function updateDrag(event: PointerEvent): void {
  if (!dragState) {
    return;
  }
  const annotation = annotations.find((ann) => ann.id === dragState?.id);
  if (!annotation) {
    return;
  }
  const deltaX = (event.clientX - dragState.startX) / pageWidth;
  const deltaY = (event.clientY - dragState.startY) / pageHeight;

  if (dragState.mode === "move") {
    annotation.x = clamp(dragState.original.x + deltaX, 0, 1 - annotation.width);
    annotation.y = clamp(dragState.original.y + deltaY, 0, 1 - annotation.height);
  } else {
    annotation.width = clamp(dragState.original.width + deltaX, 0.02, 1 - annotation.x);
    annotation.height = clamp(dragState.original.height + deltaY, 0.02, 1 - annotation.y);
  }
  markAnnotationDirty(annotation);
  renderCurrentLayer();
}

function finishDrag(): void {
  if (!dragState) {
    return;
  }
  dragState = null;
  commitHistory();
  renderInspector();
  renderCurrentLayer();
}

function renderInspector(): void {
  const body = byId("inspectorBody");
  const status = byId("statusLine");
  const selected = selectedAnnotation();
  status.textContent = selected ? "선택됨" : "";

  if (!pdfDocument) {
    body.innerHTML = `
      <p class="status-line">PDF를 열면 편집 속성이 여기에 표시됩니다.</p>
    `;
    return;
  }

  const currentIndex = pageItems.findIndex((item) => item.id === currentPageId);
  const documentControls = documentFields();
  const pageControls = `
    <div class="field">
      <label>현재 페이지</label>
      <div class="mini-actions">
        <button id="movePageUp" type="button">앞으로</button>
        <button id="movePageDown" type="button">뒤로</button>
        <button id="rotatePage" type="button">회전</button>
        <button id="duplicatePage" type="button">복제</button>
        <button id="extractPage" type="button">추출</button>
        <button id="deletePage" type="button">삭제</button>
      </div>
    </div>
    <p class="status-line">${currentIndex + 1} / ${pageItems.length}쪽 · 확대 ${Math.round(zoom * 100)}%</p>
  `;

  if (!selected) {
    body.innerHTML = `
      ${documentControls}
      ${pageControls}
      <p class="status-line">기존 글씨를 클릭하면 Acrobat처럼 내용과 글씨 크기를 바로 편집할 수 있습니다. 새 글씨는 텍스트 도구로 추가하세요.</p>
    `;
    bindDocumentControls();
    bindPageControls();
    return;
  }

  body.innerHTML = `
    ${documentControls}
    ${pageControls}
    ${selected.type === "text" ? textFields(selected) : ""}
    ${selected.type === "formField" ? formFieldFields(selected) : ""}
    ${selected.type !== "image" && selected.type !== "formField" ? colorField(selected) : ""}
    ${selected.type !== "text" && selected.type !== "image" && selected.type !== "formField" ? opacityField(selected) : ""}
    ${selected.type === "pen" || selected.type === "rect" ? strokeField(selected) : ""}
    <div class="field-row">
      <div class="field">
        <label>X</label>
        <input id="posX" type="number" min="0" max="100" step="1" value="${Math.round(selected.x * 100)}" />
      </div>
      <div class="field">
        <label>Y</label>
        <input id="posY" type="number" min="0" max="100" step="1" value="${Math.round(selected.y * 100)}" />
      </div>
    </div>
    ${selected.type !== "pen" ? sizeFields(selected) : ""}
    <div class="mini-actions">
      <button id="duplicateSelected" type="button">복제</button>
      <button id="deleteSelected" type="button">삭제</button>
    </div>
  `;
  bindDocumentControls();
  bindPageControls();
  bindInspectorFields(selected);
}

function documentFields(): string {
  return `
    <div class="field">
      <label>저장 방식</label>
      <select id="saveMode">
        <option value="flatten"${saveMode === "flatten" ? " selected" : ""}>Flatten content stream</option>
        <option value="native"${saveMode === "native" ? " selected" : ""}>Native PDF annotations</option>
      </select>
    </div>
    <div class="field">
      <label>가리기 정책</label>
      <select id="redactionMode">
        <option value="textOnly"${redactionMode === "textOnly" ? " selected" : ""}>텍스트만 실제 제거</option>
        <option value="visualArea"${redactionMode === "visualArea" ? " selected" : ""}>보이는 영역 픽셀 제거</option>
        <option value="imagesAndText"${redactionMode === "imagesAndText" ? " selected" : ""}>이미지와 텍스트 제거</option>
      </select>
    </div>
    <details class="metadata-panel">
      <summary>문서 메타데이터</summary>
      <div class="field">
        <label>제목</label>
        <input id="metaTitle" type="text" value="${escapeHtml(documentMetadata.title)}" />
      </div>
      <div class="field">
        <label>작성자</label>
        <input id="metaAuthor" type="text" value="${escapeHtml(documentMetadata.author)}" />
      </div>
      <div class="field">
        <label>주제</label>
        <input id="metaSubject" type="text" value="${escapeHtml(documentMetadata.subject)}" />
      </div>
      <div class="field">
        <label>키워드</label>
        <input id="metaKeywords" type="text" value="${escapeHtml(documentMetadata.keywords)}" />
      </div>
    </details>
  `;
}

function textFields(annotation: TextAnnotation): string {
  return `
    <div class="field">
      <label>텍스트</label>
      <textarea id="textValue">${escapeHtml(annotation.text)}</textarea>
    </div>
    <div class="field">
      <label>글자 크기</label>
      <input id="fontSize" type="number" min="8" max="96" step="1" value="${annotation.fontSize}" />
    </div>
  `;
}

function formFieldFields(annotation: FormFieldAnnotation): string {
  const valueControl = annotation.fieldType === "checkbox"
    ? `
      <label class="checkbox-line">
        <input id="formChecked" type="checkbox"${annotation.checked ? " checked" : ""} />
        선택됨
      </label>
    `
    : `<input id="formValue" type="text" value="${escapeHtml(annotation.fieldValue)}" />`;
  return `
    <div class="field">
      <label>폼 필드</label>
      <input id="formName" type="text" value="${escapeHtml(annotation.fieldName)}" disabled />
    </div>
    <div class="field">
      <label>값</label>
      ${valueControl}
    </div>
  `;
}

function colorField(annotation: Annotation): string {
  return `
    <div class="field">
      <label>색상</label>
      <input id="colorValue" type="color" value="${annotation.color}" />
    </div>
  `;
}

function opacityField(annotation: Annotation): string {
  return `
    <div class="field">
      <label>불투명도</label>
      <input id="opacityValue" type="range" min="0.05" max="1" step="0.05" value="${annotation.opacity}" />
    </div>
  `;
}

function strokeField(annotation: Annotation): string {
  return `
    <div class="field">
      <label>선 두께</label>
      <input id="strokeWidth" type="range" min="1" max="12" step="1" value="${annotation.strokeWidth}" />
    </div>
  `;
}

function sizeFields(annotation: Annotation): string {
  return `
    <div class="field-row">
      <div class="field">
        <label>너비</label>
        <input id="boxWidth" type="number" min="2" max="100" step="1" value="${Math.round(annotation.width * 100)}" />
      </div>
      <div class="field">
        <label>높이</label>
        <input id="boxHeight" type="number" min="2" max="100" step="1" value="${Math.round(annotation.height * 100)}" />
      </div>
    </div>
  `;
}

function bindPageControls(): void {
  byId("movePageUp").addEventListener("click", () => moveCurrentPage(-1));
  byId("movePageDown").addEventListener("click", () => moveCurrentPage(1));
  byId("rotatePage").addEventListener("click", rotateCurrentPage);
  byId("duplicatePage").addEventListener("click", duplicateCurrentPage);
  byId("extractPage").addEventListener("click", () => void extractCurrentPage());
  byId("deletePage").addEventListener("click", deleteCurrentPage);
}

function bindDocumentControls(): void {
  const saveModeField = document.querySelector<HTMLSelectElement>("#saveMode");
  saveModeField?.addEventListener("change", () => {
    saveMode = saveModeField.value === "native" ? "native" : "flatten";
    commitHistory();
  });
  const redactionModeField = document.querySelector<HTMLSelectElement>("#redactionMode");
  redactionModeField?.addEventListener("change", () => {
    if (redactionModeField.value === "visualArea" || redactionModeField.value === "imagesAndText") {
      redactionMode = redactionModeField.value;
    } else {
      redactionMode = "textOnly";
    }
    commitHistory();
  });

  bindMetadataField("metaTitle", "title");
  bindMetadataField("metaAuthor", "author");
  bindMetadataField("metaSubject", "subject");
  bindMetadataField("metaKeywords", "keywords");
}

function bindMetadataField(id: string, key: keyof DocumentMetadata): void {
  const input = document.querySelector<HTMLInputElement>(`#${id}`);
  input?.addEventListener("change", () => {
    documentMetadata = {
      ...documentMetadata,
      [key]: input.value,
    };
    commitHistory();
  });
}

function bindInspectorFields(annotation: Annotation): void {
  const bindNumber = (id: string, update: (value: number) => void): void => {
    const input = byId<HTMLInputElement>(id);
    input.addEventListener("change", () => {
      update(Number(input.value));
      markAnnotationDirty(annotation);
      commitHistory();
      renderInspector();
      renderCurrentLayer();
    });
  };

  bindNumber("posX", (value) => {
    annotation.x = clamp(value / 100, 0, 1 - annotation.width);
  });
  bindNumber("posY", (value) => {
    annotation.y = clamp(value / 100, 0, 1 - annotation.height);
  });

  const textValue = document.querySelector<HTMLTextAreaElement>("#textValue");
  textValue?.addEventListener("change", () => {
    if (annotation.type === "text") {
      annotation.text = textValue.value;
      markAnnotationDirty(annotation);
      autoFitText(annotation);
      commitHistory();
      renderInspector();
      renderCurrentLayer();
    }
  });

  const formValue = document.querySelector<HTMLInputElement>("#formValue");
  formValue?.addEventListener("change", () => {
    if (annotation.type === "formField" && annotation.fieldType === "text") {
      annotation.fieldValue = formValue.value;
      markAnnotationDirty(annotation);
      commitHistory();
      renderInspector();
      renderCurrentLayer();
    }
  });

  const formChecked = document.querySelector<HTMLInputElement>("#formChecked");
  formChecked?.addEventListener("change", () => {
    if (annotation.type === "formField" && annotation.fieldType === "checkbox") {
      annotation.checked = formChecked.checked;
      annotation.fieldValue = formChecked.checked ? annotation.exportValue ?? "Yes" : "Off";
      markAnnotationDirty(annotation);
      commitHistory();
      renderInspector();
      renderCurrentLayer();
    }
  });

  const fontSize = document.querySelector<HTMLInputElement>("#fontSize");
  fontSize?.addEventListener("change", () => {
    if (annotation.type === "text") {
      annotation.fontSize = clamp(Number(fontSize.value), 8, 96);
      markAnnotationDirty(annotation);
      autoFitText(annotation);
      commitHistory();
      renderInspector();
      renderCurrentLayer();
    }
  });

  const colorValue = document.querySelector<HTMLInputElement>("#colorValue");
  colorValue?.addEventListener("input", () => {
    annotation.color = colorValue.value;
    markAnnotationDirty(annotation);
    renderCurrentLayer();
  });
  colorValue?.addEventListener("change", commitHistory);

  const opacityValue = document.querySelector<HTMLInputElement>("#opacityValue");
  opacityValue?.addEventListener("input", () => {
    annotation.opacity = Number(opacityValue.value);
    markAnnotationDirty(annotation);
    renderCurrentLayer();
  });
  opacityValue?.addEventListener("change", commitHistory);

  const strokeWidth = document.querySelector<HTMLInputElement>("#strokeWidth");
  strokeWidth?.addEventListener("input", () => {
    annotation.strokeWidth = Number(strokeWidth.value);
    markAnnotationDirty(annotation);
    renderCurrentLayer();
  });
  strokeWidth?.addEventListener("change", commitHistory);

  const boxWidth = document.querySelector<HTMLInputElement>("#boxWidth");
  boxWidth?.addEventListener("change", () => {
    annotation.width = clamp(Number(boxWidth.value) / 100, 0.02, 1 - annotation.x);
    markAnnotationDirty(annotation);
    if (annotation.type === "text") {
      autoFitText(annotation);
    }
    commitHistory();
    renderInspector();
    renderCurrentLayer();
  });
  const boxHeight = document.querySelector<HTMLInputElement>("#boxHeight");
  boxHeight?.addEventListener("change", () => {
    annotation.height = clamp(Number(boxHeight.value) / 100, 0.02, 1 - annotation.y);
    markAnnotationDirty(annotation);
    commitHistory();
    renderInspector();
    renderCurrentLayer();
  });

  byId("duplicateSelected").addEventListener("click", duplicateSelected);
  byId("deleteSelected").addEventListener("click", deleteSelected);
}

function moveCurrentPage(delta: -1 | 1): void {
  const index = pageItems.findIndex((item) => item.id === currentPageId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= pageItems.length) {
    return;
  }
  const [item] = pageItems.splice(index, 1);
  pageItems.splice(target, 0, item);
  commitHistory();
  refreshAll();
}

function rotateCurrentPage(): void {
  const item = currentPage();
  if (!item) {
    return;
  }
  item.rotation = (item.rotation + 90) % 360;
  commitHistory();
  refreshAll();
}

function deleteCurrentPage(): void {
  if (pageItems.length <= 1 || !currentPageId) {
    showToast("마지막 페이지는 삭제할 수 없습니다.");
    return;
  }
  const index = pageItems.findIndex((item) => item.id === currentPageId);
  const [removed] = pageItems.splice(index, 1);
  annotations = annotations.filter((annotation) => annotation.pageId !== removed.id);
  currentPageId = pageItems[Math.min(index, pageItems.length - 1)]?.id ?? null;
  selectedId = null;
  commitHistory();
  refreshAll();
}

function duplicateCurrentPage(): void {
  const index = pageItems.findIndex((item) => item.id === currentPageId);
  if (index < 0) {
    return;
  }
  const source = pageItems[index];
  const copy: PageItem = {
    ...source,
    id: crypto.randomUUID(),
  };
  pageItems.splice(index + 1, 0, copy);
  cloneSourceTextItemsForPage(source.id, copy.id);
  cloneSourceImageItemsForPage(source.id, copy.id);
  const copiedAnnotations = annotations
    .filter((annotation) => annotation.pageId === source.id)
    .map((annotation) => {
      const cloned = cloneAnnotation(annotation);
      cloned.id = crypto.randomUUID();
      cloned.pageId = copy.id;
      if (cloned.type === "text") {
        delete cloned.sourceTextId;
        delete cloned.eraseOriginal;
        cloned.reflowable = false;
      }
      delete cloned.sourceAnnotationId;
      delete cloned.sourceAnnotationSubtype;
      delete cloned.sourceImageId;
      cloned.dirty = true;
      return cloned;
    });
  annotations.push(...copiedAnnotations);
  currentPageId = copy.id;
  selectedId = null;
  commitHistory();
  refreshAll();
}

function cloneSourceTextItemsForPage(sourcePageId: string, targetPageId: string): void {
  const sourceItems = sourceTextItemsByPage.get(sourcePageId) ?? [];
  sourceTextItemsByPage.set(
    targetPageId,
    sourceItems.map((item, index) => ({
      ...item,
      id: `${targetPageId}:block-${index}`,
      pageId: targetPageId,
    })),
  );
}

function cloneSourceImageItemsForPage(sourcePageId: string, targetPageId: string): void {
  const sourceItems = sourceImageItemsByPage.get(sourcePageId) ?? [];
  sourceImageItemsByPage.set(
    targetPageId,
    sourceItems.map((item, index) => ({
      ...item,
      id: `${targetPageId}:image-${index}`,
      pageId: targetPageId,
    })),
  );
}

async function extractCurrentPage(): Promise<void> {
  const index = pageItems.findIndex((item) => item.id === currentPageId);
  if (index < 0) {
    return;
  }
  const editedBytes = await buildExportPdfBytes();
  await validateExportedPdf(editedBytes, pageItems.length);
  const source = await PDFDocument.load(editedBytes);
  const output = await PDFDocument.create();
  const [page] = await output.copyPages(source, [index]);
  output.addPage(page);
  applyPdfLibMetadata(output);
  const bytes = new Uint8Array(await output.save());
  await validateExportedPdf(bytes, 1);
  downloadPdf(bytes, "현재 페이지를 별도 PDF로 추출했습니다.");
}

function duplicateSelected(): void {
  const selected = selectedAnnotation();
  if (!selected) {
    return;
  }
  const copy = cloneAnnotation(selected);
  copy.id = crypto.randomUUID();
  if (copy.type === "text") {
    delete copy.sourceTextId;
    delete copy.eraseOriginal;
  }
  delete copy.sourceAnnotationId;
  delete copy.sourceAnnotationSubtype;
  delete copy.sourceImageId;
  copy.dirty = true;
  copy.x = clamp(copy.x + 0.02, 0, 1 - copy.width);
  copy.y = clamp(copy.y + 0.02, 0, 1 - copy.height);
  annotations.push(copy);
  selectedId = copy.id;
  commitHistory();
  renderInspector();
  renderCurrentLayer();
}

function deleteSelected(): void {
  if (!selectedId) {
    return;
  }
  const selected = selectedAnnotation();
  if (selected?.sourceAnnotationId) {
    deletedSourceAnnotations.push(sourceAnnotationRef(selected));
  }
  annotations = annotations.filter((annotation) => annotation.id !== selectedId);
  selectedId = null;
  commitHistory();
  renderInspector();
  renderCurrentLayer();
}

function markAnnotationDirty(annotation: Annotation): void {
  if (annotation.sourceAnnotationId) {
    annotation.dirty = true;
  }
}

function sourceAnnotationRef(annotation: Annotation): SourceAnnotationRef {
  return {
    sourceAnnotationId: annotation.sourceAnnotationId ?? "",
    pageId: annotation.pageId,
    subtype: annotation.sourceAnnotationSubtype ?? annotation.type,
    x: annotation.x,
    y: annotation.y,
    width: annotation.width,
    height: annotation.height,
  };
}

async function searchPdf(query: string): Promise<void> {
  const text = query.trim().toLowerCase();
  if (!text || !pdfDocument) {
    return;
  }

  for (const item of pageItems) {
    const page = await requirePage(item.sourceIndex);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((entry) => ("str" in entry ? String(entry.str) : ""))
      .join(" ")
      .toLowerCase();
    if (pageText.includes(text)) {
      currentPageId = item.id;
      selectedId = null;
      await renderWorkspace();
      renderInspector();
      showToast(`검색어를 ${pageItems.indexOf(item) + 1}쪽에서 찾았습니다.`);
      return;
    }
  }
  showToast("검색 결과가 없습니다.");
}

async function exportPdf(): Promise<void> {
  if (!originalBytes || !pdfDocument) {
    showToast("먼저 PDF를 열어주세요.");
    return;
  }

  let bytes: Uint8Array;
  try {
    bytes = await buildExportPdfBytes();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "PDF 저장에 실패했습니다.");
    return;
  }
  const validation = await validateExportedPdf(bytes, pageItems.length);
  if (!validation.ok) {
    showToast(`PDF 검증 실패: ${validation.errors.join(", ")}`);
    return;
  }
  downloadPdf(bytes, "PDF 엔진으로 저장하고 검증했습니다.");
}

async function buildExportPdfBytes(): Promise<Uint8Array> {
  if (!originalBytes || !pdfDocument) {
    throw new Error("PDF is not loaded.");
  }

  const engineBytes = await tryExportWithEngine();
  if (engineBytes) {
    return engineBytes;
  }
  if (isStrictEngineRequired() || requiresPdfEngineForSafeExport()) {
    throw new Error("PDF 엔진이 꺼져 있어 고급 편집을 안전하게 저장할 수 없습니다. npm run engine:serve를 실행하세요.");
  }

  const source = await PDFDocument.load(originalBytes);
  const output = await PDFDocument.create();
  output.registerFontkit(fontkit);
  applyPdfLibMetadata(output);
  const editorFonts = await loadEditorFonts(output);

  for (const item of pageItems) {
    const page = pageHasSourceTextEdit(item.id)
      ? await buildReflowPage(output, item, editorFonts)
      : await copyOriginalPage(source, output, item);
    const pageAnnotations = annotations.filter((annotation) => annotation.pageId === item.id);
    for (const annotation of pageAnnotations) {
      if (annotation.type === "text" && annotation.sourceTextId) {
        continue;
      }
      await drawAnnotation(output, page, annotation, editorFonts);
    }
  }

  const bytes = await output.save();
  return new Uint8Array(bytes);
}

function isStrictEngineRequired(): boolean {
  return import.meta.env.VITE_STRICT_ENGINE === "true";
}

function requiresPdfEngineForSafeExport(): boolean {
  return (
    saveMode === "native" ||
    Boolean(openPassword) ||
    deletedSourceAnnotations.length > 0 ||
    annotations.some((annotation) => {
      if (annotation.sourceImageId) {
        return true;
      }
      if (annotation.sourceAnnotationId) {
        return true;
      }
      if (annotation.type === "redact") {
        return true;
      }
      return annotation.type === "text" && Boolean(annotation.sourceTextId || annotation.eraseOriginal);
    }) ||
    pageItems.some((item) => layoutFlowSlicesForPage(item.id).length > 0)
  );
}

async function tryExportWithEngine(): Promise<Uint8Array | null> {
  if (!originalBytes) {
    return null;
  }
  const payload = buildEnginePayload(originalBytes);
  const endpoints = buildEngineEndpoints();
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        continue;
      }
      const result: unknown = await response.json();
      if (isEngineApplyResponse(result)) {
        return base64ToBytes(result.pdfBase64);
      }
    } catch (error) {
      console.warn(`PDF engine export failed at ${endpoint}`, error);
    }
  }
  return null;
}

function buildEngineEndpoints(apiPath = "/api/pdf/apply"): string[] {
  const sameOriginEndpoint = `${window.location.origin}${apiPath}`;
  const localEngineEndpoint = `http://127.0.0.1:8787${apiPath}`;
  const isLocalDevelopment = ["127.0.0.1", "localhost"].includes(window.location.hostname);
  return !isLocalDevelopment || sameOriginEndpoint === localEngineEndpoint
    ? [sameOriginEndpoint]
    : [sameOriginEndpoint, localEngineEndpoint];
}

function buildEnginePayload(bytes: Uint8Array): EnginePayload {
  const pageIndexById = new Map(pageItems.map((item, index) => [item.id, index]));
  const deleteOperations = buildEngineAnnotationDeleteOperations(pageIndexById);
  const annotationOperations = annotations
    .flatMap((annotation) => {
      const pageIndex = pageIndexById.get(annotation.pageId);
      if (pageIndex === undefined) {
        return [];
      }
      const replacementOperation = annotationToEngineOperation(annotation, pageIndex);
      if (!replacementOperation) {
        return [];
      }
      if (annotation.sourceAnnotationId && annotation.dirty && annotation.type !== "formField") {
        return [sourceAnnotationDeleteOperation(sourceAnnotationRef(annotation), pageIndex), replacementOperation];
      }
      return [replacementOperation];
    })
    .filter((operation): operation is EngineOperation => Boolean(operation));
  const flowSliceOperations = buildEngineFlowSliceOperations(pageIndexById);
  const flowOperations = buildEngineFlowOperations(pageIndexById);

  return {
    pdfBase64: bytesToBase64(bytes),
    password: openPassword || undefined,
    pages: pageItems.map((item) => ({
      sourceIndex: item.sourceIndex,
      rotation: item.rotation,
    })),
    operations: [...deleteOperations, ...flowSliceOperations, ...annotationOperations, ...flowOperations],
    sourceTexts: buildEngineSourceTexts(pageIndexById),
    metadata: documentMetadata,
    saveOptions: {
      annotationMode: saveMode,
      redactionMode,
      flattenForms: false,
      validate: true,
    },
  };
}

function buildEngineAnnotationDeleteOperations(pageIndexById: Map<string, number>): EngineOperation[] {
  const operations: EngineOperation[] = [];
  const seen = new Set<string>();
  for (const ref of deletedSourceAnnotations) {
    const pageIndex = pageIndexById.get(ref.pageId);
    if (pageIndex === undefined) {
      continue;
    }
    const operation = sourceAnnotationDeleteOperation(ref, pageIndex);
    const key = `${operation.pageIndex}:${operation.sourceAnnotationId}:${operation.annotationSubtype}:${operation.x}:${operation.y}:${operation.width}:${operation.height}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    operations.push(operation);
  }
  return operations;
}

function sourceAnnotationDeleteOperation(ref: SourceAnnotationRef, pageIndex: number): EngineOperation {
  return {
    type: "deleteAnnotation",
    pageIndex,
    x: ref.x,
    y: ref.y,
    width: ref.width,
    height: ref.height,
    color: "#ffffff",
    opacity: 1,
    strokeWidth: 0,
    sourceAnnotationId: ref.sourceAnnotationId,
    annotationSubtype: ref.subtype,
  };
}

function buildEngineSourceTexts(pageIndexById: Map<string, number>): EngineSourceText[] {
  const sourceTexts: EngineSourceText[] = [];
  for (const [pageId, items] of sourceTextItemsByPage.entries()) {
    const pageIndex = pageIndexById.get(pageId);
    if (pageIndex === undefined) {
      continue;
    }
    for (const item of items) {
      sourceTexts.push({
        pageIndex,
        sourceTextId: item.id,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        text: item.text,
        fontSize: item.fontSize,
        fontFamily: item.fontFamily,
        fontName: item.fontName,
      });
    }
  }
  return sourceTexts;
}

function buildEngineFlowOperations(pageIndexById: Map<string, number>): EngineOperation[] {
  const operations: EngineOperation[] = [];
  for (const [pageId, items] of sourceTextItemsByPage.entries()) {
    const pageIndex = pageIndexById.get(pageId);
    if (pageIndex === undefined) {
      continue;
    }
    if (layoutFlowSlicesForPage(pageId).length > 0) {
      continue;
    }
    for (const item of items) {
      if (isSourceTextAlreadyEdited(item.id)) {
        continue;
      }
      const offset = sourceTextFlowOffset(item);
      if (offset === 0) {
        continue;
      }
      operations.push({
        type: "text",
        pageIndex,
        x: item.x,
        y: clamp(item.y + offset, 0, 1 - item.height),
        width: item.width,
        height: item.height,
        text: item.text,
        fontSize: item.fontSize,
        fontFamily: item.fontFamily,
        fontName: item.fontName,
        color: "#172026",
        opacity: 1,
        strokeWidth: 1,
        lineHeight: 1.25,
        eraseOriginal: {
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
        },
      });
    }
  }
  return operations;
}

function buildEngineFlowSliceOperations(pageIndexById: Map<string, number>): EngineOperation[] {
  const operations: EngineOperation[] = [];
  for (const pageItem of pageItems) {
    const pageIndex = pageIndexById.get(pageItem.id);
    if (pageIndex === undefined) {
      continue;
    }
    for (const slice of layoutFlowSlicesForPage(pageItem.id)) {
      operations.push({
        type: "flowSlice",
        pageIndex,
        x: slice.x,
        y: slice.y,
        sourceY: slice.sourceY,
        width: slice.width,
        height: slice.height,
        color: "#ffffff",
        opacity: 1,
        strokeWidth: 0,
      });
    }
  }
  return operations;
}

function annotationToEngineOperation(annotation: Annotation, pageIndex: number): EngineOperation | null {
  if (annotation.sourceAnnotationId && !annotation.dirty) {
    return null;
  }
  const base = {
    type: annotation.type,
    pageIndex,
    x: annotation.x,
    y: annotation.y,
    width: annotation.width,
    height: annotation.height,
    color: annotation.color,
    opacity: annotation.opacity,
    strokeWidth: annotation.strokeWidth,
  };

  if (annotation.sourceImageId && annotation.type === "redact") {
    return {
      ...base,
      type: "deleteImage",
      sourceImageId: annotation.sourceImageId,
    };
  }

  if (annotation.type === "text") {
    return {
      ...base,
      text: annotation.text,
      fontSize: annotation.fontSize,
      fontFamily: annotation.fontFamily,
      fontName: annotation.fontName,
      lineHeight: 1.25,
      eraseOriginal: annotation.eraseOriginal,
    };
  }

  if (annotation.type === "image") {
    return {
      ...base,
      dataUrl: annotation.dataUrl,
    };
  }

  if (annotation.type === "formField") {
    return {
      ...base,
      fieldName: annotation.fieldName,
      fieldType: annotation.fieldType,
      fieldValue: annotation.fieldValue,
      checked: annotation.checked,
      exportValue: annotation.exportValue,
    };
  }

  if (annotation.type === "pen") {
    return {
      ...base,
      points: annotation.points,
    };
  }

  return base;
}

function isEngineApplyResponse(value: unknown): value is EngineApplyResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).pdfBase64 === "string"
  );
}

function isEngineExtractResponse(value: unknown): value is EngineExtractResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const pages = (value as Record<string, unknown>).pages;
  if (!Array.isArray(pages)) {
    return false;
  }
  return pages.every((rawPage) => {
    if (typeof rawPage !== "object" || rawPage === null) {
      return false;
    }
    const page = rawPage as Record<string, unknown>;
    const images = page.images;
    return (
      typeof page.index === "number" &&
      (images === undefined ||
        (Array.isArray(images) &&
          images.every((rawImage) => {
            if (typeof rawImage !== "object" || rawImage === null) {
              return false;
            }
            const image = rawImage as Record<string, unknown>;
            return (
              typeof image.id === "string" &&
              typeof image.x === "number" &&
              typeof image.y === "number" &&
              typeof image.width === "number" &&
              typeof image.height === "number"
            );
          })))
    );
  });
}

async function validateExportedPdf(bytes: Uint8Array, expectedPageCount: number): Promise<ExportValidation> {
  const errors: string[] = [];
  let pageCount = 0;
  let encrypted = false;
  let engineValidation: ExportValidation | null = null;
  try {
    const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
    const document = await loadingTask.promise;
    pageCount = document.numPages;
    if (pageCount !== expectedPageCount) {
      errors.push(`page count ${pageCount} != expected ${expectedPageCount}`);
    }
    await document.destroy();
  } catch (error) {
    encrypted = isPasswordError(error);
    errors.push(error instanceof Error ? error.message : "exported PDF could not be opened");
  }

  engineValidation = await tryValidateWithEngine(bytes);
  if (engineValidation) {
    if (engineValidation.pageCount !== expectedPageCount) {
      errors.push(`engine page count ${engineValidation.pageCount} != expected ${expectedPageCount}`);
    }
    if (!engineValidation.ok) {
      errors.push(...engineValidation.errors);
    }
  }

  return {
    ok: errors.length === 0,
    pageCount,
    encrypted,
    qpdfChecked: engineValidation?.qpdfChecked,
    annotationCount: engineValidation?.annotationCount,
    textLength: engineValidation?.textLength,
    pageSizes: engineValidation?.pageSizes,
    errors,
  };
}

async function tryValidateWithEngine(bytes: Uint8Array): Promise<ExportValidation | null> {
  const endpoints = buildEngineEndpoints("/api/pdf/validate");
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ pdfBase64: bytesToBase64(bytes) }),
      });
      if (!response.ok) {
        continue;
      }
      const result: unknown = await response.json();
      if (isExportValidation(result)) {
        return result;
      }
    } catch (error) {
      console.warn(`PDF engine validation failed at ${endpoint}`, error);
    }
  }
  return null;
}

function isExportValidation(value: unknown): value is ExportValidation {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.ok === "boolean" &&
    typeof candidate.pageCount === "number" &&
    typeof candidate.encrypted === "boolean" &&
    Array.isArray(candidate.errors)
  );
}

function applyPdfLibMetadata(document: PDFDocument): void {
  const { title, author, subject, keywords, creator, producer } = documentMetadata;
  if (title) {
    document.setTitle(title);
  }
  if (author) {
    document.setAuthor(author);
  }
  if (subject) {
    document.setSubject(subject);
  }
  if (keywords) {
    document.setKeywords(keywords.split(",").map((keyword) => keyword.trim()).filter(Boolean));
  }
  document.setCreator(creator || "PDF Studio");
  document.setProducer(producer || "PDF Studio Engine");
}

function downloadPdf(bytes: Uint8Array, message: string): void {
  const stableBytes = new Uint8Array(bytes);
  const blob = new Blob([stableBytes.buffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  showToast(message);
}

async function copyOriginalPage(
  source: PDFDocument,
  output: PDFDocument,
  item: PageItem,
): Promise<PDFPage> {
  const [page] = await output.copyPages(source, [item.sourceIndex]);
  output.addPage(page);
  if (item.rotation) {
    page.setRotation(degrees((page.getRotation().angle + item.rotation) % 360));
  }
  return page;
}

async function buildReflowPage(
  output: PDFDocument,
  item: PageItem,
  editorFonts: EditorFonts,
): Promise<PDFPage> {
  const background = await renderTextlessBackground(item);
  const page = output.addPage([background.width, background.height]);
  const image = await output.embedPng(background.dataUrl);
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: background.width,
    height: background.height,
  });

  for (const sourceText of sourceTextItemsByPage.get(item.id) ?? []) {
    const textAnnotation = sourceTextToAnnotation(sourceText);
    drawPdfText(page, textAnnotation, editorFonts, {
      x: textAnnotation.x * background.width,
      y: background.height - textAnnotation.y * background.height - textAnnotation.height * background.height,
      width: textAnnotation.width * background.width,
      height: textAnnotation.height * background.height,
    });
  }
  return page;
}

async function renderTextlessBackground(
  item: PageItem,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const page = await requirePage(item.sourceIndex);
  const scale = 2;
  const viewport = page.getViewport({ scale, rotation: item.rotation });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not render PDF page for export.");
  }
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  context.fillStyle = "#ffffff";
  for (const sourceText of sourceTextItemsByPage.get(item.id) ?? []) {
    if (!isSourceTextAlreadyEdited(sourceText.id)) {
      continue;
    }
    context.fillRect(
      sourceText.x * viewport.width - 3,
      sourceText.y * viewport.height - 3,
      sourceText.width * viewport.width + 6,
      sourceText.height * viewport.height + 6,
    );
  }
  return {
    dataUrl: canvas.toDataURL("image/png"),
    width: viewport.width / scale,
    height: viewport.height / scale,
  };
}

async function drawAnnotation(
  doc: PDFDocument,
  page: PDFPage,
  annotation: Annotation,
  editorFonts: EditorFonts,
): Promise<void> {
  const pageBox = {
    width: page.getWidth(),
    height: page.getHeight(),
  };
  const x = annotation.x * pageBox.width;
  const width = annotation.width * pageBox.width;
  const height = annotation.height * pageBox.height;
  const y = pageBox.height - annotation.y * pageBox.height - height;

  if (annotation.type === "text") {
    if (annotation.eraseOriginal) {
      drawEraseRectangle(page, annotation.eraseOriginal, pageBox);
    }
    drawPdfText(page, annotation, editorFonts, { x, y, width, height });
    return;
  }

  if (annotation.type === "image") {
    const image = annotation.dataUrl.includes("image/jpeg")
      ? await doc.embedJpg(annotation.dataUrl)
      : await doc.embedPng(annotation.dataUrl);
    page.drawImage(image, { x, y, width, height, opacity: annotation.opacity });
    return;
  }

  if (annotation.type === "pen") {
    for (let index = 1; index < annotation.points.length; index += 1) {
      const start = annotation.points[index - 1];
      const end = annotation.points[index];
      page.drawLine({
        start: {
          x: start.x * pageBox.width,
          y: pageBox.height - start.y * pageBox.height,
        },
        end: {
          x: end.x * pageBox.width,
          y: pageBox.height - end.y * pageBox.height,
        },
        thickness: annotation.strokeWidth,
        color: toRgb(annotation.color),
        opacity: annotation.opacity,
      });
    }
    return;
  }

  if (annotation.type === "redact") {
    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: rgb(1, 1, 1),
      opacity: 1,
    });
    return;
  }

  if (annotation.type === "highlight") {
    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: toRgb(annotation.color),
      opacity: annotation.opacity,
    });
    return;
  }

  page.drawRectangle({
    x,
    y,
    width,
    height,
    borderColor: toRgb(annotation.color),
    borderWidth: annotation.strokeWidth,
    opacity: annotation.opacity,
  });
}

function drawEraseRectangle(
  page: PDFPage,
  region: { x: number; y: number; width: number; height: number },
  pageBox: { width: number; height: number },
): void {
  const padding = 2;
  const x = region.x * pageBox.width - padding;
  const width = region.width * pageBox.width + padding * 2;
  const height = region.height * pageBox.height + padding * 2;
  const y = pageBox.height - region.y * pageBox.height - height + padding;
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(1, 1, 1),
    opacity: 1,
  });
}

async function loadEditorFonts(doc: PDFDocument): Promise<EditorFonts> {
  const response = await fetch(editorFontUrl);
  const fontBytes = await response.arrayBuffer();
  return {
    korean: await doc.embedFont(fontBytes, { subset: true }),
    latin: await doc.embedFont(StandardFonts.Helvetica),
  };
}

function drawPdfText(
  page: PDFPage,
  annotation: TextAnnotation,
  fonts: EditorFonts,
  box: { x: number; y: number; width: number; height: number },
): void {
  const font = chooseFontForText(fonts, annotation.text);
  const fontSize = annotation.fontSize;
  const lineHeight = fontSize * 1.25;
  const lines = wrapTextWithFont(font, annotation.text, fontSize, Math.max(12, box.width - 4));
  for (let index = 0; index < lines.length; index += 1) {
    const lineY = box.y + box.height - 2 - fontSize - index * lineHeight;
    if (lineY < box.y) {
      return;
    }
    page.drawText(lines[index], {
      x: box.x + 2,
      y: lineY,
      size: fontSize,
      font,
      color: toRgb(annotation.color),
      opacity: annotation.opacity,
    });
  }
}

function chooseFontForText(fonts: EditorFonts, text: string): PDFFont {
  return /[^\u0000-\u00ff]/.test(text) ? fonts.korean : fonts.latin;
}

function wrapTextWithFont(
  font: PDFFont,
  text: string,
  fontSize: number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    const words = rawLine.split(/(\s+)/).filter(Boolean);
    let line = "";
    for (const word of words.length ? words : [""]) {
      const test = line + word;
      if (font.widthOfTextAtSize(test, fontSize) <= maxWidth || !line) {
        line = test;
        if (font.widthOfTextAtSize(line, fontSize) > maxWidth) {
          const broken = breakLongText(font, line, fontSize, maxWidth);
          lines.push(...broken.slice(0, -1));
          line = broken[broken.length - 1] ?? "";
        }
      } else {
        lines.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    lines.push(line);
  }
  return lines;
}

function breakLongText(
  font: PDFFont,
  text: string,
  fontSize: number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const char of Array.from(text)) {
    const test = line + char;
    if (line && font.widthOfTextAtSize(test, fontSize) > maxWidth) {
      lines.push(line);
      line = char;
    } else {
      line = test;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}

function autoFitText(annotation: TextAnnotation): void {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const pdfPageWidth = pageWidth > 0 ? pageWidth / zoom : 612;
  const pdfPageHeight = pageHeight > 0 ? pageHeight / zoom : 792;
  const boxWidth = Math.max(16, annotation.width * pdfPageWidth - 4);
  context.font = `${annotation.fontSize}px ${annotation.fontFamily ?? defaultEditorFontFamily()}`;
  const lines = wrapText(context, annotation.text || " ", boxWidth);
  const textHeight = lines.length * annotation.fontSize * 1.25 + 8;
  annotation.height = clamp(textHeight / pdfPageHeight, 0.035, 1 - annotation.y);
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    const words = rawLine.split(/(\s+)/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const test = line + word;
      if (context.measureText(test).width > maxWidth && line) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else {
        line = test;
      }
    }
    lines.push(line);
  }
  return lines;
}

function setZoom(value: number): void {
  zoom = clamp(value, 0.45, 2.4);
  syncZoomLabels();
  refreshAll(false);
}

function syncZoomLabels(): void {
  document.querySelectorAll<HTMLElement>("[data-zoom-label]").forEach((element) => {
    element.textContent = `${Math.round(zoom * 100)}%`;
  });
}

function clearSelection(): void {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  selectedId = null;
  dragState = null;
  draftState = null;
  pendingImageDataUrl = null;
  currentTool = "select";
  renderToolbar();
  renderInspector();
  renderCurrentLayer();
}

function commitHistory(): void {
  undoStack.push(makeSnapshot());
  redoStack = [];
}

function undo(): void {
  if (undoStack.length <= 1) {
    return;
  }
  const current = undoStack.pop();
  if (current) {
    redoStack.push(current);
  }
  applySnapshot(undoStack[undoStack.length - 1]);
  refreshAll();
}

function redo(): void {
  const snapshot = redoStack.pop();
  if (!snapshot) {
    return;
  }
  undoStack.push(snapshot);
  applySnapshot(snapshot);
  refreshAll();
}

function makeSnapshot(): Snapshot {
  return {
    annotations: annotations.map(cloneAnnotation),
    pageItems: pageItems.map((item) => ({ ...item })),
    currentPageId,
    documentMetadata: { ...documentMetadata },
    saveMode,
    redactionMode,
    deletedSourceAnnotations: deletedSourceAnnotations.map((annotation) => ({ ...annotation })),
  };
}

function applySnapshot(snapshot: Snapshot): void {
  annotations = snapshot.annotations.map(cloneAnnotation);
  pageItems = snapshot.pageItems.map((item) => ({ ...item }));
  currentPageId = snapshot.currentPageId;
  documentMetadata = { ...snapshot.documentMetadata };
  saveMode = snapshot.saveMode;
  redactionMode = snapshot.redactionMode;
  deletedSourceAnnotations = snapshot.deletedSourceAnnotations.map((annotation) => ({ ...annotation }));
  selectedId = null;
}

function cloneAnnotation<T extends Annotation>(annotation: T): T {
  return JSON.parse(JSON.stringify(annotation)) as T;
}

function isPdfTextItem(item: unknown): item is PdfTextItem {
  if (typeof item !== "object" || item === null) {
    return false;
  }
  const candidate = item as Record<string, unknown>;
  return (
    typeof candidate.str === "string" &&
    typeof candidate.fontName === "string" &&
    isNumberArray(candidate.transform, 6) &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number"
  );
}

function refreshAll(updateInspector = true): void {
  void renderWorkspace();
  if (updateInspector) {
    renderInspector();
  }
}

function currentPage(): PageItem | null {
  return pageItems.find((item) => item.id === currentPageId) ?? null;
}

function selectedAnnotation(): Annotation | null {
  return annotations.find((annotation) => annotation.id === selectedId) ?? null;
}

async function requirePage(sourceIndex: number): Promise<pdfjs.PDFPageProxy> {
  if (!pdfDocument) {
    throw new Error("No PDF is loaded.");
  }
  return pdfDocument.getPage(sourceIndex + 1);
}

function eventPoint(event: PointerEvent, layer: HTMLElement): { x: number; y: number } {
  const rect = layer.getBoundingClientRect();
  return {
    x: clamp(event.clientX - rect.left, 0, rect.width),
    y: clamp(event.clientY - rect.top, 0, rect.height),
  };
}

function toRelativePoint(x: number, y: number): Point {
  return {
    x: clamp(x / pageWidth, 0, 1),
    y: clamp(y / pageHeight, 0, 1),
  };
}

function toRgb(hex: string): RGB {
  const clean = hex.replace("#", "");
  const red = parseInt(clean.slice(0, 2), 16) / 255;
  const green = parseInt(clean.slice(2, 4), 16) / 255;
  const blue = parseInt(clean.slice(4, 6), 16) / 255;
  return rgb(red, green, blue);
}

function normalizePdfFontFamily(value: string): string {
  const lower = value.toLowerCase();
  if (lower.includes("times") || lower.includes("serif") || lower.includes("cmr")) {
    return '"Times New Roman", Times, serif';
  }
  if (lower.includes("courier") || lower.includes("mono") || lower.includes("typewriter")) {
    return '"Courier New", Courier, monospace';
  }
  if (lower.includes("apple") || lower.includes("gothic")) {
    return "AppleGothic, sans-serif";
  }
  return defaultEditorFontFamily();
}

function defaultEditorFontFamily(): string {
  return 'AppleGothic, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
}

function showToast(message: string): void {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.add("hidden");
  }, 3200);
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function requireAppRoot(): HTMLDivElement {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (!root) {
    throw new Error("App root was not found.");
  }
  return root;
}

renderApp();
