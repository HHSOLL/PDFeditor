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
import {
  bindCommandButton as bindFeatureCommandButton,
  configureFeatureCommands,
  executeCommand,
  getFeatureCommand,
  registerCommand,
  syncCommandButtons,
} from "./featureCommands";
import { renderPreflightPanel } from "./preflightPanel";
import { renderFormFieldInspector } from "./formFieldPanel";
import { buildEngineSaveOptions } from "./enginePayload";
import {
  applyPdfWithEngine,
  batchPdfWithEngine,
  buildEngineEndpoints,
  comparePdfWithEngine,
  correctOcrPdfWithEngine,
  getOcrStatusWithEngine,
  ocrPdfWithEngine,
  preflightPdfWithEngine,
  repairAccessibilityWithEngine,
  signPdfWithCertificate,
  validateSignatureWithEngine,
  validatePdfWithEngine,
} from "./export/engineClient";
import type {
  Annotation,
  BoxAnnotation,
  DocumentMetadata,
  DraftState,
  DragState,
  EditorFonts,
  EngineOperation,
  EnginePayload,
  EngineSourceText,
  ExportValidation,
  FlowedSourceText,
  FormFieldAnnotation,
  ImageAnnotation,
  OcrStatus,
  PageFlowSlice,
  PageItem,
  PdfTextItem,
  PdfTextStyle,
  PenAnnotation,
  Point,
  PreflightReport,
  RedactionMode,
  SaveMode,
  SignatureValidation,
  BatchResult,
  CompareResult,
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
let sanitizeHiddenInfo = false;
let lastPreflightReport: PreflightReport | null = null;
let lastOcrStatus: OcrStatus | null = null;
let lastSignatureValidation: SignatureValidation | null = null;
let compareBytes: Uint8Array | null = null;
let compareFileName = "";
let lastCompareResult: CompareResult | null = null;
let batchWatermarkText = "Batch watermark";
let batchRedactText = "";
let batchSanitizeHiddenInfo = true;
let lastBatchResult: BatchResult | null = null;
let ocrLanguage = "eng+kor";
let ocrCorrectionText = "";
let ocrCorrectionPage = 1;
let accessibilityLanguage = "ko-KR";
let accessibilityAltText = "";
let certificatePem = "";
let certificateKeyPem = "";
let certificateSignerName = "PDFeditor signer";
let certificateReason = "Document approval";
let certificateLocation = "Local";
let certificateLockPolicy: "none" | "noChanges" | "formFill" | "formFillAnnotate" = "formFill";
let openPassword = "";
let currentPageId: string | null = null;
let selectedId: string | null = null;
let currentTool: Tool = "select";
let zoom = 1;
let activePageMetrics: PageMetrics | null = null;
let dragState: DragState | null = null;
let draftState: DraftState | null = null;
let pendingImageDataUrl: string | null = null;
let undoStack: Snapshot[] = [];
let redoStack: Snapshot[] = [];
let toastTimer = 0;
let renderCycle = 0;
let pageScrollLockUntil = 0;
let currentPageScrollFrame = 0;
let pageVisibilityObserver: IntersectionObserver | null = null;
let pageMetricsById = new Map<string, PageMetrics>();
let semanticReflowPlanCache: { key: string; plan: ReflowPlan } | null = null;

const tools: Array<{ id: Tool; label: string; icon: string }> = [
  { id: "select", label: "선택", icon: "↖" },
  { id: "text", label: "텍스트 편집", icon: "T" },
  { id: "highlight", label: "강조", icon: "▰" },
  { id: "pen", label: "그리기", icon: "╱" },
  { id: "rect", label: "도형", icon: "□" },
  { id: "form", label: "양식", icon: "▣" },
  { id: "redact", label: "지우기", icon: "⌫" },
];

const dom = {
  fileInput: document.createElement("input"),
  imageInput: document.createElement("input"),
  compareInput: document.createElement("input"),
  certificateInput: document.createElement("input"),
  certificateKeyInput: document.createElement("input"),
};

configureFeatureCommands({ onDisabledCommand: showToast });

registerCommand({
  id: "open-file",
  label: "파일 열기",
  implemented: true,
  enabled: () => true,
  run: () => dom.fileInput.click(),
});
registerCommand({
  id: "export-pdf",
  label: "저장",
  implemented: true,
  enabled: () => Boolean(originalBytes && pdfDocument),
  disabledReason: () => "먼저 PDF를 열어주세요.",
  run: () => void exportPdf(),
});
registerCommand({
  id: "preflight-pdf",
  label: "사전 검사",
  implemented: true,
  enabled: () => Boolean(originalBytes && pdfDocument),
  disabledReason: () => "먼저 PDF를 열어주세요.",
  run: () => void runPreflightCheck(),
});
registerCommand({
  id: "ocr-status",
  label: "OCR 상태 확인",
  implemented: true,
  enabled: () => Boolean(originalBytes && pdfDocument),
  disabledReason: () => "먼저 PDF를 열어주세요.",
  run: () => void runOcrStatusCheck(),
});
registerCommand({
  id: "ocr-run",
  label: "OCR 실행",
  implemented: true,
  enabled: () => Boolean(originalBytes && pdfDocument),
  disabledReason: () => "먼저 PDF를 열어주세요.",
  run: () => void runOcrOnDocument(),
});
registerCommand({
  id: "ocr-correct",
  label: "OCR 보정 저장",
  implemented: true,
  enabled: () => Boolean(originalBytes && pdfDocument && ocrCorrectionText.trim()),
  disabledReason: () => "PDF를 열고 보정할 OCR 텍스트를 입력하세요.",
  run: () => void correctOcrOnDocument(),
});
registerCommand({
  id: "accessibility-repair",
  label: "접근성 기본 수리",
  implemented: true,
  enabled: () => Boolean(originalBytes && pdfDocument),
  disabledReason: () => "먼저 PDF를 열어주세요.",
  run: () => void repairAccessibilityOnDocument(),
});
registerCommand({
  id: "certificate-sign",
  label: "인증서 서명",
  implemented: true,
  enabled: () => Boolean(originalBytes && pdfDocument && certificatePem && certificateKeyPem),
  disabledReason: () => "PDF와 PEM 인증서/개인키를 먼저 준비하세요.",
  run: () => void signDocumentWithCertificate(),
});
registerCommand({
  id: "signature-validate",
  label: "서명 검증",
  implemented: true,
  enabled: () => Boolean(originalBytes && pdfDocument),
  disabledReason: () => "먼저 PDF를 열어주세요.",
  run: () => void validateCurrentSignature(),
});
registerCommand({
  id: "compare-run",
  label: "PDF 비교",
  implemented: true,
  enabled: () => Boolean(originalBytes && pdfDocument && compareBytes),
  disabledReason: () => "현재 PDF와 비교할 다른 PDF를 선택하세요.",
  run: () => void runCompareWithSelectedPdf(),
});
registerCommand({
  id: "batch-run",
  label: "배치 실행",
  implemented: true,
  enabled: () => Boolean(originalBytes && pdfDocument && (batchWatermarkText.trim() || batchRedactText.trim() || batchSanitizeHiddenInfo)),
  disabledReason: () => "PDF를 열고 배치 단계 하나 이상을 설정하세요.",
  run: () => void runBatchQuickAction(),
});
registerCommand({
  id: "undo",
  label: "실행 취소",
  implemented: true,
  enabled: () => undoStack.length > 1,
  disabledReason: () => "실행 취소할 작업이 없습니다.",
  run: undo,
});
registerCommand({
  id: "redo",
  label: "다시 실행",
  implemented: true,
  enabled: () => redoStack.length > 0,
  disabledReason: () => "다시 실행할 작업이 없습니다.",
  run: redo,
});
registerCommand({
  id: "zoom-out",
  label: "축소",
  implemented: true,
  enabled: () => zoom > 0.45,
  disabledReason: () => "최소 확대율입니다.",
  run: () => setZoom(zoom - 0.15),
});
registerCommand({
  id: "zoom-in",
  label: "확대",
  implemented: true,
  enabled: () => zoom < 2.4,
  disabledReason: () => "최대 확대율입니다.",
  run: () => setZoom(zoom + 0.15),
});
registerCommand({
  id: "previous-page",
  label: "이전 페이지",
  implemented: true,
  enabled: () => pageItems.findIndex((item) => item.id === currentPageId) > 0,
  disabledReason: () => "첫 페이지입니다.",
  run: () => goToRelativePage(-1),
});
registerCommand({
  id: "next-page",
  label: "다음 페이지",
  implemented: true,
  enabled: () => {
    const index = pageItems.findIndex((item) => item.id === currentPageId);
    return index >= 0 && index < pageItems.length - 1;
  },
  disabledReason: () => "마지막 페이지입니다.",
  run: () => goToRelativePage(1),
});
registerCommand({
  id: "move-page-up",
  label: "앞으로",
  implemented: true,
  enabled: () => pageItems.findIndex((item) => item.id === currentPageId) > 0,
  disabledReason: () => "첫 페이지는 앞으로 이동할 수 없습니다.",
  run: () => moveCurrentPage(-1),
});
registerCommand({
  id: "move-page-down",
  label: "뒤로",
  implemented: true,
  enabled: () => {
    const index = pageItems.findIndex((item) => item.id === currentPageId);
    return index >= 0 && index < pageItems.length - 1;
  },
  disabledReason: () => "마지막 페이지는 뒤로 이동할 수 없습니다.",
  run: () => moveCurrentPage(1),
});
registerCommand({
  id: "rotate-page",
  label: "회전",
  implemented: true,
  enabled: () => Boolean(currentPageId),
  disabledReason: () => "회전할 페이지가 없습니다.",
  run: rotateCurrentPage,
});
registerCommand({
  id: "duplicate-page",
  label: "복제",
  implemented: true,
  enabled: () => Boolean(currentPageId),
  disabledReason: () => "복제할 페이지가 없습니다.",
  run: duplicateCurrentPage,
});
registerCommand({
  id: "extract-page",
  label: "추출",
  implemented: true,
  enabled: () => Boolean(currentPageId && originalBytes && pdfDocument),
  disabledReason: () => "추출할 PDF를 먼저 열어주세요.",
  run: () => void extractCurrentPage(),
});
registerCommand({
  id: "delete-page",
  label: "삭제",
  implemented: true,
  enabled: () => pageItems.length > 1 && Boolean(currentPageId),
  disabledReason: () => "마지막 페이지는 삭제할 수 없습니다.",
  run: deleteCurrentPage,
});

type PdfPageViewport = {
  width: number;
  height: number;
  convertToViewportRectangle(rect: [number, number, number, number]): number[];
  convertToViewportPoint(x: number, y: number): number[];
};

type NormalizedRect = Pick<SourceAnnotationRef, "x" | "y" | "width" | "height">;
type PageMetrics = {
  pageId: string;
  width: number;
  height: number;
};
type LayoutBlock = {
  id: string;
  pageId: string;
  type: "text" | "image" | "caption" | "figure";
  bbox: NormalizedRect;
  flowId: string;
  movable: boolean;
  protected: boolean;
  sourceObjectId?: string;
  groupId?: string;
};
type ReflowTarget = {
  sourceTextId: string;
  sourcePageId: string;
  pageId: string;
  y: number;
  reason: "height-delta" | "protected-block" | "page-overflow";
};
type ReflowPlan = {
  blocks: LayoutBlock[];
  movedBlocks: ReflowTarget[];
  unresolvedCollisions: string[];
};
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
function bindCommandButton(id: string, commandId: string): void {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLButtonElement)) {
    return;
  }
  const command = getFeatureCommand(commandId);
  if (!command) {
    element.hidden = true;
    return;
  }
  bindFeatureCommandButton(element, command);
}

function renderApp(): void {
  appRoot.innerHTML = `
    <main class="app-shell">
      <header class="app-header">
        <section class="app-brand" aria-label="앱">
          <div class="brand-mark">PDF</div>
          <strong>PDF 편집기</strong>
        </section>
        <section class="document-tabs" aria-label="열린 문서">
          <button class="doc-tab active" type="button" disabled title="문서 탭 관리는 아직 지원하지 않습니다.">
            <span id="documentName">문서를 열어주세요</span>
            <span aria-hidden="true">×</span>
          </button>
          <button class="new-tab" type="button" disabled title="새 탭은 아직 지원하지 않습니다.">+</button>
        </section>
        <section class="app-actions" aria-label="문서 작업">
          <span class="saved-state">● 저장됨</span>
          <button class="icon-btn" id="undoButton" type="button" title="실행 취소">↶</button>
          <button class="icon-btn" id="redoButton" type="button" title="다시 실행">↷</button>
          <button class="action-btn primary" id="exportButton" type="button" aria-label="PDF 내보내기">저장</button>
          <button class="kebab-btn" type="button" disabled title="추가 메뉴는 아직 지원하지 않습니다.">⋮</button>
        </section>
      </header>
      <nav class="menu-bar" aria-label="문서 메뉴">
        <button id="openButton" type="button">파일</button>
        <button type="button" disabled title="상단 메뉴 명령은 툴바와 속성 패널에서 제공합니다.">편집</button>
        <button type="button" disabled title="보기 명령은 확대/축소 컨트롤에서 제공합니다.">보기</button>
        <button type="button" disabled title="삽입 명령은 툴바에서 제공합니다.">삽입</button>
        <button type="button" disabled title="주석 명령은 툴바에서 제공합니다.">주석</button>
        <button type="button" disabled title="페이지 명령은 오른쪽 속성 패널에서 제공합니다.">페이지</button>
        <button type="button" disabled title="도구 모음에 구현된 기능만 표시합니다.">도구</button>
        <button type="button" disabled title="양식 생성과 작성은 툴바와 속성 패널에서 제공합니다.">양식</button>
        <button type="button" disabled title="보안 기능은 가리기 정책부터 지원합니다.">보안</button>
      </nav>
      <section class="ribbon" aria-label="PDF 편집 도구">
        <nav class="toolbar" id="toolbar" aria-label="PDF 편집 도구"></nav>
        <section class="ribbon-controls" aria-label="보기 설정">
          <button class="icon-btn" id="zoomOutButton" type="button" title="축소">−</button>
          <span class="zoom-chip" data-zoom-label>100%</span>
          <button class="icon-btn" id="zoomInButton" type="button" title="확대">+</button>
          <button class="view-mode active" type="button" disabled title="연속 페이지 보기로 고정됩니다.">▣</button>
          <button class="view-mode" type="button" disabled title="맞춤 보기는 아직 지원하지 않습니다.">▤</button>
        </section>
      </section>
      <section class="workspace">
        <aside class="activity-rail" aria-label="패널">
          <button class="rail-item active" type="button"><span>▯</span><small>페이지</small></button>
          <button class="rail-item" type="button" disabled title="북마크 패널은 아직 지원하지 않습니다."><span>⌑</span><small>북마크</small></button>
          <button class="rail-item" type="button" disabled title="주석 목록 패널은 아직 지원하지 않습니다."><span>☰</span><small>주석</small></button>
          <button class="rail-item" type="button" disabled title="양식 전용 목록 패널은 아직 지원하지 않습니다. 툴바의 양식 도구를 사용하세요."><span>▤</span><small>양식</small></button>
          <button class="rail-item" type="button" disabled title="첨부파일 패널은 아직 지원하지 않습니다."><span>⌘</span><small>첨부파일</small></button>
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
          <button class="icon-btn" id="previousPageButton" type="button" title="이전 페이지">‹</button>
          <span class="page-number-chip" id="bottomCurrentPage">1</span>
          <span class="status-line">/ <span id="bottomPageCount">0</span></span>
          <button class="icon-btn" id="nextPageButton" type="button" title="다음 페이지">›</button>
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
  dom.compareInput.type = "file";
  dom.compareInput.accept = ".pdf,application/pdf";
  dom.compareInput.id = "compareInput";
  dom.compareInput.className = "hidden";
  dom.certificateInput.type = "file";
  dom.certificateInput.accept = ".pem,.crt,.cer,.txt";
  dom.certificateInput.id = "certificateInput";
  dom.certificateInput.className = "hidden";
  dom.certificateKeyInput.type = "file";
  dom.certificateKeyInput.accept = ".pem,.key,.txt";
  dom.certificateKeyInput.id = "certificateKeyInput";
  dom.certificateKeyInput.className = "hidden";
  appRoot.append(dom.fileInput, dom.imageInput, dom.compareInput, dom.certificateInput, dom.certificateKeyInput);

  bindStaticEvents();
  renderToolbar();
  renderDocumentName();
  syncZoomLabels();
  renderWorkspace();
  renderInspector();
}

function bindStaticEvents(): void {
  bindCommandButton("openButton", "open-file");
  bindCommandButton("exportButton", "export-pdf");
  bindCommandButton("undoButton", "undo");
  bindCommandButton("redoButton", "redo");
  bindCommandButton("zoomOutButton", "zoom-out");
  bindCommandButton("zoomInButton", "zoom-in");
  bindCommandButton("zoomOutFooter", "zoom-out");
  bindCommandButton("zoomInFooter", "zoom-in");
  bindCommandButton("previousPageButton", "previous-page");
  bindCommandButton("nextPageButton", "next-page");

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

  dom.compareInput.addEventListener("change", () => {
    const file = dom.compareInput.files?.[0];
    if (!file) {
      return;
    }
    void file.arrayBuffer().then((buffer) => {
      compareBytes = new Uint8Array(buffer);
      compareFileName = file.name;
      lastCompareResult = null;
      showToast(`${file.name} 비교 PDF를 불러왔습니다.`);
      renderInspector();
    });
  });

  dom.certificateInput.addEventListener("change", () => {
    const file = dom.certificateInput.files?.[0];
    if (!file) {
      return;
    }
    void readTextFile(file).then((text) => {
      certificatePem = text;
      showToast(`${file.name} 인증서를 불러왔습니다.`);
      renderInspector();
    });
  });

  dom.certificateKeyInput.addEventListener("change", () => {
    const file = dom.certificateKeyInput.files?.[0];
    if (!file) {
      return;
    }
    void readTextFile(file).then((text) => {
      certificateKeyPem = text;
      showToast(`${file.name} 개인키를 불러왔습니다.`);
      renderInspector();
    });
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
    button.disabled = !pdfDocument;
    button.title = pdfDocument ? tool.label : "먼저 PDF를 열어주세요.";
    button.innerHTML = `<span class="tool-icon">${tool.icon}</span><span>${tool.label}</span>`;
    button.addEventListener("click", () => {
      if (!pdfDocument) {
        showToast("먼저 PDF를 열어주세요.");
        return;
      }
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
  imageButton.disabled = !pdfDocument;
  imageButton.title = pdfDocument ? "이미지 삽입" : "먼저 PDF를 열어주세요.";
  imageButton.innerHTML = `<span class="tool-icon">▧</span><span>이미지</span>`;
  imageButton.addEventListener("click", () => {
    if (!pdfDocument) {
      showToast("먼저 PDF를 열어주세요.");
      return;
    }
    dom.imageInput.click();
  });
  toolbar.append(imageButton);

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "검색";
  searchInput.ariaLabel = "PDF 텍스트 검색";
  searchInput.disabled = !pdfDocument;
  searchInput.title = pdfDocument ? "PDF 텍스트 검색" : "먼저 PDF를 열어주세요.";
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
  await loadPdfBytes(bytes, file.name.replace(/\.pdf$/i, "") + "-edited.pdf", `${file.name} 파일을 열었습니다.`);
}

async function loadPdfBytes(bytes: Uint8Array, nextFileName: string, message: string): Promise<void> {
  originalBytes = bytes;
  fileName = nextFileName;
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
  sanitizeHiddenInfo = false;
  lastPreflightReport = null;
  lastSignatureValidation = null;
  lastCompareResult = null;
  lastBatchResult = null;
  selectedId = null;
  currentPageId = pageItems[0]?.id ?? null;
  await cacheSourceTextItems();
  await cacheSourceImageItems(bytes);
  await importExistingAnnotations();
  undoStack = [makeSnapshot()];
  redoStack = [];
  renderDocumentName();
  renderToolbar();
  await renderWorkspace();
  renderInspector();
  showToast(message);
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
  pageVisibilityObserver?.disconnect();
  pageVisibilityObserver = null;
  pageMetricsById = new Map();
  activePageMetrics = null;
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
    byId("emptyOpenButton").addEventListener("click", () => void executeCommand("open-file"));
    updateCurrentPageIndicators();
    return;
  }

  pageCount.textContent = `${pageItems.length}쪽`;
  if (bottomPageCount) {
    bottomPageCount.textContent = `${pageItems.length}`;
  }
  syncZoomLabels();
  const documentStack = document.createElement("div");
  documentStack.className = "document-stack";
  canvasArea.append(documentStack);
  for (let index = 0; index < pageItems.length; index += 1) {
    const item = pageItems[index];
    const thumbnail = renderThumbnail(item, index);
    pageList.append(thumbnail);
    const stage = await createPageStage(item, index);
    if (cycle !== renderCycle) {
      return;
    }
    documentStack.append(stage);
    if (item.id === currentPageId) {
      await renderPageStage(stage, item);
    }
  }

  const current = currentPage();
  if (!current) {
    return;
  }
  const currentStage = pageStage(current.id);
  if (currentStage) {
    await renderPageStage(currentStage, current);
  }
  if (cycle !== renderCycle) {
    return;
  }
  observePageStages(canvasArea);
  canvasArea.removeEventListener("scroll", scheduleCurrentPageFromScroll);
  canvasArea.addEventListener("scroll", scheduleCurrentPageFromScroll, { passive: true });
  if (currentStage && pageItems[0]?.id !== current.id) {
    currentStage.scrollIntoView({ block: "start" });
  }
  updateCurrentPageIndicators();
}

function renderThumbnail(item: PageItem, index: number): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `thumb${item.id === currentPageId ? " active" : ""}`;
  button.dataset.pageId = item.id;
  button.addEventListener("click", () => {
    currentPageId = item.id;
    selectedId = null;
    scrollPageIntoView(item.id);
    updateCurrentPageIndicators();
    renderInspector();
  });

  const placeholder = document.createElement("div");
  placeholder.className = "thumb-placeholder";
  const pageAnnotations = annotations.filter((ann) => ann.pageId === item.id).length;
  button.append(placeholder);
  button.insertAdjacentHTML(
    "beforeend",
    `<div class="thumb-meta"><span>${index + 1}쪽</span>${pageAnnotations ? `<span class="badge">${pageAnnotations}</span>` : ""}</div>`,
  );
  void hydrateThumbnail(button, item);
  return button;
}

async function hydrateThumbnail(button: HTMLButtonElement, item: PageItem): Promise<void> {
  try {
    const page = await requirePage(item.sourceIndex);
    const viewport = page.getViewport({ scale: 0.18, rotation: item.rotation });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext("2d");
    if (context) {
      await page.render({ canvas, canvasContext: context, viewport }).promise;
    }
    button.querySelector(".thumb-placeholder")?.replaceWith(canvas);
  } catch (error) {
    console.warn("thumbnail render failed", error);
  }
}

async function createPageStage(item: PageItem, index: number): Promise<HTMLDivElement> {
  const page = await requirePage(item.sourceIndex);
  const viewport = page.getViewport({ scale: zoom, rotation: item.rotation });
  const metrics = setPageMetrics(item.id, viewport.width, viewport.height);

  const stage = document.createElement("div");
  stage.className = `page-stage${item.id === currentPageId ? " active" : ""}`;
  stage.dataset.pageId = item.id;
  stage.dataset.pageNumber = `${index + 1}`;
  stage.setAttribute("aria-label", `${index + 1}쪽`);
  const shell = document.createElement("div");
  shell.className = "page-shell";
  shell.style.width = `${metrics.width}px`;
  shell.style.height = `${metrics.height}px`;

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-label", `${index + 1}쪽 PDF 페이지`);
  canvas.dataset.pending = "true";
  canvas.style.width = `${metrics.width}px`;
  canvas.style.height = `${metrics.height}px`;
  const layer = document.createElement("div");
  layer.className = "annotation-layer";
  layer.dataset.pageId = item.id;
  layer.addEventListener("pointerdown", (event) => handleLayerPointerDown(event, item.id));
  layer.addEventListener("pointermove", handleLayerPointerMove);
  layer.addEventListener("pointerup", handleLayerPointerUp);
  layer.addEventListener("pointercancel", cancelDraft);

  shell.append(canvas, layer);
  stage.append(shell);
  return stage;
}

async function renderPageStage(stage: HTMLDivElement, item: PageItem): Promise<void> {
  if (stage.dataset.rendered === "true" || stage.dataset.rendering === "true") {
    return;
  }
  stage.dataset.rendering = "true";
  const page = await requirePage(item.sourceIndex);
  const viewport = page.getViewport({ scale: zoom, rotation: item.rotation });
  const metrics = setPageMetrics(item.id, viewport.width, viewport.height);
  setActivePageMetrics(item.id);

  const canvas = stage.querySelector<HTMLCanvasElement>("canvas");
  const layer = stage.querySelector<HTMLElement>(".annotation-layer");
  if (!canvas || !layer) {
    delete stage.dataset.rendering;
    return;
  }
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(metrics.width * ratio);
  canvas.height = Math.floor(metrics.height * ratio);
  canvas.style.width = `${metrics.width}px`;
  canvas.style.height = `${metrics.height}px`;
  const context = canvas.getContext("2d");
  if (context) {
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    pageCanvasSnapshots.set(item.id, canvas.toDataURL("image/png"));
  }
  delete canvas.dataset.pending;
  renderLayerContents(layer, item, metrics);
  stage.dataset.rendered = "true";
  delete stage.dataset.rendering;
}

function setPageMetrics(pageId: string, width: number, height: number): PageMetrics {
  const metrics = { pageId, width, height };
  pageMetricsById.set(pageId, metrics);
  if (pageId === currentPageId) {
    activePageMetrics = metrics;
  }
  return metrics;
}

function setActivePageMetrics(pageId: string): boolean {
  const metrics = pageMetricsById.get(pageId);
  if (!metrics) {
    return false;
  }
  activePageMetrics = metrics;
  return true;
}

function metricsForPage(pageId: string): PageMetrics | null {
  return pageMetricsById.get(pageId) ?? null;
}

function metricsForLayer(layer: HTMLElement): PageMetrics | null {
  const pageId = layer.dataset.pageId;
  return pageId ? metricsForPage(pageId) : null;
}

function fallbackMetrics(pageId: string): PageMetrics {
  return metricsForPage(pageId) ?? activePageMetrics ?? { pageId, width: 612 * zoom, height: 792 * zoom };
}

function pageStage(pageId: string): HTMLDivElement | null {
  return document.querySelector<HTMLDivElement>(`.page-stage[data-page-id="${pageId}"]`);
}

function observePageStages(canvasArea: HTMLElement): void {
  pageVisibilityObserver?.disconnect();
  pageVisibilityObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || !(entry.target instanceof HTMLDivElement)) {
          continue;
        }
        const pageId = entry.target.dataset.pageId;
        const item = pageItems.find((candidate) => candidate.id === pageId);
        if (item) {
          void renderPageStage(entry.target, item);
        }
      }
    },
    {
      root: canvasArea,
      rootMargin: "900px 0px",
      threshold: 0.01,
    },
  );
  document.querySelectorAll<HTMLDivElement>(".page-stage").forEach((stage) => {
    pageVisibilityObserver?.observe(stage);
  });
}

function scheduleCurrentPageFromScroll(): void {
  if (currentPageScrollFrame) {
    return;
  }
  currentPageScrollFrame = window.requestAnimationFrame(() => {
    currentPageScrollFrame = 0;
    updateCurrentPageFromScroll();
  });
}

function updateCurrentPageFromScroll(): void {
  if (Date.now() < pageScrollLockUntil) {
    return;
  }
  const canvasArea = byId("canvasArea");
  const areaRect = canvasArea.getBoundingClientRect();
  const anchorY = areaRect.top + areaRect.height * 0.35;
  let best: { id: string; distance: number } | null = null;
  const stages = Array.from(document.querySelectorAll<HTMLDivElement>(".page-stage"));
  for (const stage of stages) {
    const pageId = stage.dataset.pageId;
    if (!pageId) {
      continue;
    }
    const rect = stage.getBoundingClientRect();
    const containsAnchor = rect.top <= anchorY && rect.bottom >= anchorY;
    const distance = containsAnchor ? 0 : Math.min(Math.abs(rect.top - anchorY), Math.abs(rect.bottom - anchorY));
    if (!best || distance < best.distance) {
      best = { id: pageId, distance };
    }
  }
  if (best && best.id !== currentPageId) {
    currentPageId = best.id;
    setActivePageMetrics(best.id);
    updateCurrentPageIndicators();
    renderInspector();
  }
}

function updateCurrentPageIndicators(): void {
  const currentIndex = pageItems.findIndex((item) => item.id === currentPageId);
  const displayIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
  const currentPage = document.querySelector<HTMLElement>("#bottomCurrentPage");
  if (currentPage) {
    currentPage.textContent = `${displayIndex}`;
  }
  document.querySelectorAll<HTMLDivElement>(".page-stage").forEach((stage) => {
    stage.classList.toggle("active", stage.dataset.pageId === currentPageId);
  });
  document.querySelectorAll<HTMLButtonElement>(".thumb").forEach((thumb) => {
    thumb.classList.toggle("active", thumb.dataset.pageId === currentPageId);
  });
  scrollActiveThumbnailIntoView();
  syncCommandButtons();
}

function scrollActiveThumbnailIntoView(): void {
  const pageList = document.querySelector<HTMLElement>("#pageList");
  const activeThumb = pageList?.querySelector<HTMLElement>(".thumb.active");
  if (!pageList || !activeThumb) {
    return;
  }
  const listRect = pageList.getBoundingClientRect();
  const thumbRect = activeThumb.getBoundingClientRect();
  if (thumbRect.top < listRect.top) {
    pageList.scrollTop -= listRect.top - thumbRect.top;
  } else if (thumbRect.bottom > listRect.bottom) {
    pageList.scrollTop += thumbRect.bottom - listRect.bottom;
  }
}

function scrollPageIntoView(pageId: string): void {
  const stage = pageStage(pageId);
  if (!stage) {
    return;
  }
  pageScrollLockUntil = Date.now() + 600;
  const canvasArea = byId("canvasArea");
  canvasArea.scrollTo({ top: Math.max(0, stage.offsetTop - 24), behavior: "auto" });
  const item = pageItems.find((candidate) => candidate.id === pageId);
  if (item) {
    void renderPageStage(stage, item);
  }
}

function goToRelativePage(delta: -1 | 1): void {
  const index = pageItems.findIndex((item) => item.id === currentPageId);
  const target = clamp(index + delta, 0, Math.max(0, pageItems.length - 1));
  const item = pageItems[target];
  if (!item || item.id === currentPageId) {
    return;
  }
  currentPageId = item.id;
  selectedId = null;
  scrollPageIntoView(item.id);
  updateCurrentPageIndicators();
  renderInspector();
}

function renderAnnotation(annotation: Annotation, metrics: PageMetrics): Element {
  if (annotation.type === "pen") {
    return renderPen(annotation, metrics);
  }

  const node = document.createElement("div");
  node.className = `annotation ${annotation.type}${selectedId === annotation.id ? " selected" : ""}`;
  node.style.left = `${annotation.x * metrics.width}px`;
  node.style.top = `${annotation.y * metrics.height}px`;
  node.style.width = `${annotation.width * metrics.width}px`;
  node.style.height = `${annotation.height * metrics.height}px`;
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
        node.style.height = `${annotation.height * metrics.height}px`;
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
  node.classList.add("form-field", annotation.fieldType === "checkbox" || annotation.fieldType === "radio" ? "checkbox" : "text-field");
  node.style.borderColor = selectedId === annotation.id ? "#176b58" : "rgba(23, 107, 88, 0.55)";
  node.style.background = "rgba(255, 255, 255, 0.72)";
  if (annotation.fieldType === "signature") {
    const placeholder = document.createElement("div");
    placeholder.className = "signature-field-placeholder";
    placeholder.textContent = annotation.unsupportedReason ?? "서명 필드";
    node.append(placeholder);
    return;
  }
  if (annotation.fieldType === "checkbox" || annotation.fieldType === "radio") {
    const checkbox = document.createElement("input");
    checkbox.type = annotation.fieldType === "radio" ? "radio" : "checkbox";
    checkbox.name = annotation.fieldName;
    checkbox.checked = Boolean(annotation.checked);
    checkbox.ariaLabel = annotation.fieldName;
    checkbox.addEventListener("pointerdown", (event) => event.stopPropagation());
    checkbox.addEventListener("change", () => {
      setFormFieldChecked(annotation, checkbox.checked);
      markAnnotationDirty(annotation);
      commitHistory();
      renderInspector();
      renderCurrentLayer();
    });
    node.append(checkbox);
    return;
  }

  if (annotation.fieldType === "combo" || annotation.fieldType === "list") {
    const select = document.createElement("select");
    select.value = annotation.fieldValue;
    select.ariaLabel = annotation.fieldName;
    if (annotation.fieldType === "list") {
      select.size = Math.max(2, Math.min(6, annotation.options?.length ?? 4));
    }
    for (const optionValue of annotation.options?.length ? annotation.options : [annotation.fieldValue].filter(Boolean)) {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionValue;
      select.append(option);
    }
    select.addEventListener("pointerdown", (event) => event.stopPropagation());
    select.addEventListener("change", () => {
      annotation.fieldValue = select.value;
      markAnnotationDirty(annotation);
      syncInspectorValues(annotation);
    });
    select.addEventListener("blur", commitHistory);
    node.append(select);
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

function setFormFieldChecked(annotation: FormFieldAnnotation, checked: boolean): void {
  if (annotation.fieldType === "radio" && checked) {
    for (const peer of annotations) {
      if (
        peer.type === "formField" &&
        peer.fieldType === "radio" &&
        peer.id !== annotation.id &&
        peer.fieldName === annotation.fieldName
      ) {
        peer.checked = false;
        peer.fieldValue = "Off";
        markAnnotationDirty(peer);
      }
    }
  }
  annotation.checked = checked;
  annotation.fieldValue = checked ? annotation.exportValue ?? "Yes" : "Off";
}

function setNewFormFieldType(annotation: FormFieldAnnotation, fieldType: FormFieldAnnotation["fieldType"]): void {
  annotation.fieldType = fieldType;
  annotation.fieldName = annotation.fieldName || nextFormFieldName(fieldType);
  annotation.exportValue = fieldType === "checkbox" || fieldType === "radio" ? annotation.exportValue ?? "Yes" : undefined;
  annotation.checked = fieldType === "checkbox" || fieldType === "radio" ? Boolean(annotation.checked) : undefined;
  if (fieldType === "checkbox" || fieldType === "radio") {
    annotation.fieldValue = annotation.checked ? annotation.exportValue ?? "Yes" : "Off";
    annotation.width = Math.min(annotation.width, 0.06);
    annotation.height = Math.min(annotation.height, 0.04);
    return;
  }
  if (fieldType === "combo" || fieldType === "list") {
    annotation.options = annotation.options?.length ? annotation.options : ["Option 1", "Option 2"];
    annotation.fieldValue = annotation.options[0] ?? "";
    annotation.height = fieldType === "list" ? Math.max(annotation.height, 0.1) : Math.max(annotation.height, 0.05);
    return;
  }
  annotation.fieldValue = annotation.fieldValue === "Off" ? "" : annotation.fieldValue;
  annotation.options = undefined;
  annotation.height = Math.max(annotation.height, 0.05);
}

function renderPen(annotation: PenAnnotation, metrics: PageMetrics): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("pen-stroke");
  if (selectedId === annotation.id) {
    svg.classList.add("selected");
  }
  svg.setAttribute("width", `${metrics.width}`);
  svg.setAttribute("height", `${metrics.height}`);
  svg.dataset.id = annotation.id;
  svg.addEventListener("pointerdown", (event) => handleAnnotationPointerDown(event, annotation));

  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute(
    "points",
    annotation.points
      .map((point) => `${point.x * metrics.width},${point.y * metrics.height}`)
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
  currentPageId = pageId;
  setActivePageMetrics(pageId);
  updateCurrentPageIndicators();
  const metrics = metricsForLayer(event.currentTarget) ?? fallbackMetrics(pageId);
  const point = eventPoint(event, event.currentTarget, metrics);

  if (pendingImageDataUrl) {
    addImage(pageId, point.x, point.y, pendingImageDataUrl, metrics);
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
    addText(pageId, point.x, point.y, metrics);
    return;
  }

  if (currentTool === "form") {
    addFormField(pageId, point.x, point.y, metrics);
    return;
  }

  if (currentTool === "pen") {
    draftState = {
      type: "pen",
      tool: "pen",
      pageId,
      startX: point.x,
      startY: point.y,
      points: [toRelativePoint(point.x, point.y, metrics)],
    };
    return;
  }

  draftState = {
    type: "box",
    tool: currentTool,
    pageId,
    startX: point.x,
    startY: point.y,
    points: [],
  };
}

function renderSourceTextItem(item: SourceTextItem, metrics: PageMetrics): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `source-text${item.lineCount > 1 ? " block" : ""}`;
  button.textContent = item.text;
  button.ariaLabel = `기존 PDF 글씨 편집: ${item.text}`;
  button.style.left = `${item.x * metrics.width}px`;
  button.style.top = `${item.y * metrics.height}px`;
  button.style.width = `${item.width * metrics.width}px`;
  button.style.height = `${item.height * metrics.height}px`;
  button.style.fontSize = `${item.fontSize * zoom}px`;
  button.style.fontFamily = item.fontFamily;
  button.title = "기존 PDF 글씨 편집";
  button.addEventListener("pointerdown", (event) => {
    if (currentTool !== "select") {
      return;
    }
    event.stopPropagation();
    currentPageId = item.pageId;
    setActivePageMetrics(item.pageId);
    updateCurrentPageIndicators();
    convertSourceTextToAnnotation(item);
  });
  return button;
}

function renderSourceImageItem(item: SourceImageItem, metrics: PageMetrics): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "source-image";
  button.ariaLabel = "기존 PDF 이미지 삭제 대상으로 선택";
  button.style.left = `${item.x * metrics.width}px`;
  button.style.top = `${item.y * metrics.height}px`;
  button.style.width = `${item.width * metrics.width}px`;
  button.style.height = `${item.height * metrics.height}px`;
  button.title = "기존 PDF 이미지 삭제";
  button.addEventListener("pointerdown", (event) => {
    if (currentTool !== "select") {
      return;
    }
    event.stopPropagation();
    currentPageId = item.pageId;
    setActivePageMetrics(item.pageId);
    updateCurrentPageIndicators();
    convertSourceImageToRedaction(item);
  });
  return button;
}

function renderCurrentLayer(): void {
  document.querySelectorAll<HTMLElement>(".annotation-layer").forEach((layer) => {
    const pageId = layer.dataset.pageId;
    const item = pageItems.find((candidate) => candidate.id === pageId);
    const metrics = pageId ? metricsForPage(pageId) : null;
    if (!pageId || !item || !metrics) {
      return;
    }
    renderLayerContents(layer, item, metrics);
  });
  if (currentPageId) {
    setActivePageMetrics(currentPageId);
  }
}

function refreshFlowEffects(): void {
  document.querySelectorAll<HTMLElement>(".annotation-layer").forEach((layer) => {
    const pageId = layer.dataset.pageId;
    const item = pageItems.find((candidate) => candidate.id === pageId);
    const metrics = pageId ? metricsForPage(pageId) : null;
    if (!pageId || !item || !metrics) {
      return;
    }
    layer.querySelectorAll(".source-mask, .source-text, .source-image, .flow-slice").forEach((node) => node.remove());
    const flowSlices = pageFlowSlicesForPage(item.id);
    const flowNodes = [
      ...sourceMasksForPage(item.id).map((mask) => renderSourceMask(mask, metrics)),
      ...flowSlices.map((slice) => renderPageFlowSlice(slice, metrics)),
      ...(flowSlices.length > 0
        ? []
        : flowedSourceTextsForPage(item.id).map((flowedText) => renderFlowedSourceText(flowedText, metrics))),
      ...(sourceImageItemsByPage.get(item.id) ?? [])
        .filter((sourceImage) => !isSourceImageAlreadyEdited(sourceImage.id))
        .map((sourceImage) => renderSourceImageItem(sourceImage, metrics)),
      ...(sourceTextItemsByPage.get(item.id) ?? [])
        .filter((sourceText) => !isSourceTextAlreadyEdited(sourceText.id) && !semanticReflowTarget(sourceText))
        .map((sourceText) => renderSourceTextItem(sourceText, metrics)),
    ];
    layer.prepend(...flowNodes);
  });
  if (currentPageId) {
    setActivePageMetrics(currentPageId);
  }
}

function syncInspectorValues(annotation: Annotation): void {
  const boxHeight = document.querySelector<HTMLInputElement>("#boxHeight");
  if (boxHeight) {
    boxHeight.value = `${Math.round(annotation.height * 100)}`;
  }
  if (annotation.type !== "text") {
    if (annotation.type === "formField") {
      const formValue = document.querySelector<HTMLInputElement | HTMLSelectElement>("#formValue");
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

function renderLayerContents(layer: HTMLElement, item: PageItem, metrics: PageMetrics): void {
  layer.innerHTML = "";
  const flowSlices = pageFlowSlicesForPage(item.id);
  for (const mask of sourceMasksForPage(item.id)) {
    layer.append(renderSourceMask(mask, metrics));
  }

  for (const slice of flowSlices) {
    layer.append(renderPageFlowSlice(slice, metrics));
  }

  if (flowSlices.length === 0) {
    for (const flowedText of flowedSourceTextsForPage(item.id)) {
      layer.append(renderFlowedSourceText(flowedText, metrics));
    }
  }

  for (const sourceText of sourceTextItemsByPage.get(item.id) ?? []) {
    if (!isSourceTextAlreadyEdited(sourceText.id) && !semanticReflowTarget(sourceText)) {
      layer.append(renderSourceTextItem(sourceText, metrics));
    }
  }

  for (const sourceImage of sourceImageItemsByPage.get(item.id) ?? []) {
    if (!isSourceImageAlreadyEdited(sourceImage.id)) {
      layer.append(renderSourceImageItem(sourceImage, metrics));
    }
  }

  for (const annotation of annotations.filter((ann) => ann.pageId === item.id)) {
    layer.append(renderAnnotation(annotation, metrics));
  }
}

function renderSourceMask(mask: SourceMask, metrics: PageMetrics): HTMLDivElement {
  const element = document.createElement("div");
  element.className = "source-mask";
  element.dataset.id = mask.id;
  element.style.left = `${mask.x * metrics.width}px`;
  element.style.top = `${mask.y * metrics.height}px`;
  element.style.width = `${mask.width * metrics.width}px`;
  element.style.height = `${mask.height * metrics.height}px`;
  return element;
}

function renderPageFlowSlice(slice: PageFlowSlice, metrics: PageMetrics): HTMLDivElement {
  const element = document.createElement("div");
  element.className = "flow-slice";
  element.dataset.id = slice.id;
  element.style.left = `${slice.x * metrics.width}px`;
  element.style.top = `${slice.y * metrics.height}px`;
  element.style.width = `${slice.width * metrics.width}px`;
  element.style.height = `${slice.height * metrics.height}px`;
  element.style.backgroundImage = `url("${pageCanvasSnapshots.get(slice.pageId) ?? ""}")`;
  element.style.backgroundSize = `${metrics.width}px ${metrics.height}px`;
  element.style.backgroundPosition = `-${slice.x * metrics.width}px -${slice.sourceY * metrics.height}px`;
  return element;
}

function renderFlowedSourceText(flowedText: FlowedSourceText, metrics: PageMetrics): HTMLButtonElement {
  const item = flowedText.item;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `source-text flowed-source-text${item.lineCount > 1 ? " block" : ""}`;
  button.textContent = item.text;
  button.ariaLabel = `재배치된 PDF 글씨 편집: ${item.text}`;
  button.style.left = `${item.x * metrics.width}px`;
  button.style.top = `${flowedText.y * metrics.height}px`;
  button.style.width = `${item.width * metrics.width}px`;
  button.style.height = `${item.height * metrics.height}px`;
  button.style.fontSize = `${item.fontSize * zoom}px`;
  button.style.fontFamily = item.fontFamily;
  button.title = "재배치된 기존 PDF 글씨 편집";
  button.addEventListener("pointerdown", (event) => {
    if (currentTool !== "select") {
      return;
    }
    event.stopPropagation();
    currentPageId = flowedText.pageId;
    setActivePageMetrics(flowedText.pageId);
    updateCurrentPageIndicators();
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
    const target = semanticReflowTarget(sourceText);
    if (target) {
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
  return layoutFlowSlicesForPage(pageId);
}

function layoutFlowSlicesForPage(pageId: string): PageFlowSlice[] {
  void pageId;
  return [];
  /*
   * Semantic reflow keeps moved PDF text searchable. The old flow-slice path is
   * intentionally disabled for text reflow because it rasterized downstream page
   * content and hid text structure behind an image fallback.
   */
  /*
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
  */
}

function flowedSourceTextsForPage(pageId: string): FlowedSourceText[] {
  const flowed: FlowedSourceText[] = [];
  for (const items of sourceTextItemsByPage.values()) {
    for (const item of items) {
      if (isSourceTextAlreadyEdited(item.id)) {
        continue;
      }
      const target = semanticReflowTarget(item);
      if (!target || target.pageId !== pageId) {
        continue;
      }
      flowed.push({
        id: `${item.id}:flowed`,
        item,
        pageId,
        y: target.y,
      });
    }
  }
  return flowed.sort((left, right) => left.y - right.y || left.item.x - right.item.x);
}

function semanticReflowPlan(): ReflowPlan {
  const cacheKey = semanticReflowCacheKey();
  if (semanticReflowPlanCache?.key === cacheKey) {
    return semanticReflowPlanCache.plan;
  }
  const blocks = layoutBlocksInDocument();
  const movedBlocks: ReflowTarget[] = [];
  const unresolvedCollisions: string[] = [];
  const sourceTextById = new Map<string, SourceTextItem>();
  for (const items of sourceTextItemsByPage.values()) {
    for (const item of items) {
      sourceTextById.set(item.id, item);
    }
  }

  for (const item of sourceTextById.values()) {
    if (isSourceTextAlreadyEdited(item.id) || !item.reflowable) {
      continue;
    }
    const offset = sourceTextFlowOffset(item);
    if (offset === 0) {
      continue;
    }
    const target = solveReflowTarget(item, offset, blocks);
    if (target.unresolved) {
      unresolvedCollisions.push(target.unresolved);
      continue;
    }
    if (target.pageId !== item.pageId || Math.abs(target.y - item.y) > 0.002) {
      movedBlocks.push({
        sourceTextId: item.id,
        sourcePageId: item.pageId,
        pageId: target.pageId,
        y: target.y,
        reason: target.reason,
      });
    }
  }

  const plan = { blocks, movedBlocks, unresolvedCollisions };
  semanticReflowPlanCache = { key: cacheKey, plan };
  return plan;
}

function semanticReflowTarget(item: SourceTextItem): ReflowTarget | null {
  return semanticReflowPlan().movedBlocks.find((target) => target.sourceTextId === item.id) ?? null;
}

function semanticReflowCacheKey(): string {
  const sourceEditKey = sourceEditAnnotationsInDocument()
    .map((annotation) => {
      return [
        annotation.id,
        annotation.pageId,
        annotation.sourceTextId ?? "",
        annotation.x.toFixed(4),
        annotation.y.toFixed(4),
        annotation.width.toFixed(4),
        annotation.height.toFixed(4),
        annotation.fontSize,
        annotation.text.length,
      ].join(":");
    })
    .join("|");
  return [
    pageItems.map((item) => item.id).join(","),
    Array.from(sourceTextItemsByPage.values()).reduce((count, items) => count + items.length, 0),
    Array.from(sourceImageItemsByPage.values()).reduce((count, items) => count + items.length, 0),
    sourceEditKey,
  ].join(";");
}

function layoutBlocksInDocument(): LayoutBlock[] {
  const blocks: LayoutBlock[] = [];
  for (const [pageId, images] of sourceImageItemsByPage.entries()) {
    for (const image of images) {
      if (isSourceImageAlreadyEdited(image.id)) {
        continue;
      }
      blocks.push({
        id: image.id,
        pageId,
        type: "figure",
        bbox: image,
        flowId: flowIdForRect(image),
        movable: false,
        protected: true,
        sourceObjectId: image.sourceImageId,
        groupId: image.id,
      });
      for (const caption of captionBlocksForImage(image)) {
        blocks.push(caption);
      }
    }
  }
  for (const [pageId, texts] of sourceTextItemsByPage.entries()) {
    for (const text of texts) {
      blocks.push({
        id: text.id,
        pageId,
        type: "text",
        bbox: text,
        flowId: flowIdForRect(text),
        movable: text.reflowable,
        protected: false,
        sourceObjectId: text.id,
      });
    }
  }
  return blocks;
}

function captionBlocksForImage(image: SourceImageItem): LayoutBlock[] {
  const pageTexts = sourceTextItemsByPage.get(image.pageId) ?? [];
  const captionPattern = /^(figure|fig\.|table|표|그림)\b/i;
  return pageTexts
    .filter((text) => {
      const closeBelow = text.y >= image.y + image.height - 0.01 && text.y <= image.y + image.height + 0.08;
      const overlap = horizontalOverlapRatio(text, image) >= 0.25;
      return closeBelow && overlap && captionPattern.test(text.text.trim());
    })
    .map((text) => ({
      id: `${image.id}:caption:${text.id}`,
      pageId: image.pageId,
      type: "caption" as const,
      bbox: text,
      flowId: flowIdForRect(text),
      movable: false,
      protected: true,
      sourceObjectId: text.id,
      groupId: image.id,
    }));
}

function solveReflowTarget(
  item: SourceTextItem,
  offset: number,
  blocks: LayoutBlock[],
): { pageId: string; y: number; reason: ReflowTarget["reason"]; unresolved?: string } {
  const startPageIndex = pageItems.findIndex((page) => page.id === item.pageId);
  if (startPageIndex < 0) {
    return { pageId: item.pageId, y: item.y, reason: "height-delta", unresolved: "재흐름 대상 페이지를 찾을 수 없습니다." };
  }
  let targetPageIndex = startPageIndex;
  let proposedY = item.y + offset;
  let reason: ReflowTarget["reason"] = "height-delta";
  const maxIterations = pageItems.length - startPageIndex + 1;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const page = pageItems[targetPageIndex];
    if (!page) {
      const lastPage = pageItems[pageItems.length - 1];
      if (lastPage) {
        return {
          pageId: lastPage.id,
          y: clamp(pageFlowBottom(lastPage.id, item) - item.height, 0.04, 1 - item.height),
          reason: "page-overflow",
        };
      }
      return {
        pageId: item.pageId,
        y: item.y,
        reason,
        unresolved: `${item.text.slice(0, 32)} 텍스트를 배치할 다음 페이지 공간이 없습니다.`,
      };
    }
    const flowTop = targetPageIndex === startPageIndex ? proposedY : nextPageFlowTop(page.id, item);
    const solvedY = avoidProtectedBlocks(page.id, item, flowTop, blocks);
    if (solvedY.reason === "protected-block") {
      reason = "protected-block";
    }
    if (solvedY.y + item.height <= pageFlowBottom(page.id, item)) {
      return { pageId: page.id, y: clamp(solvedY.y, 0, 1 - item.height), reason };
    }
    targetPageIndex += 1;
    proposedY = nextPageFlowTop(pageItems[targetPageIndex]?.id ?? item.pageId, item);
    reason = "page-overflow";
  }
  return {
    pageId: item.pageId,
    y: item.y,
    reason,
    unresolved: `${item.text.slice(0, 32)} 텍스트의 페이지 넘김을 해결할 수 없습니다.`,
  };
}

function avoidProtectedBlocks(
  pageId: string,
  item: SourceTextItem,
  initialY: number,
  blocks: LayoutBlock[],
): { y: number; reason: ReflowTarget["reason"] } {
  let y = Math.max(0, initialY);
  let reason: ReflowTarget["reason"] = "height-delta";
  const protectedBlocks = blocks
    .filter((block) => block.pageId === pageId && block.protected && horizontalOverlapRatio(item, block.bbox) >= 0.18)
    .sort((left, right) => left.bbox.y - right.bbox.y);
  for (const block of protectedBlocks) {
    const rect = { x: item.x, y, width: item.width, height: item.height };
    if (normalizedOverlapAreaRatio(rect, block.bbox) > 0.001 || (y < block.bbox.y && y + item.height > block.bbox.y)) {
      y = block.bbox.y + block.bbox.height + 0.012;
      reason = "protected-block";
    }
  }
  return { y, reason };
}

function nextPageFlowTop(pageId: string, item: SourceTextItem): number {
  const pageTexts = (sourceTextItemsByPage.get(pageId) ?? []).filter((text) => {
    return text.reflowable && horizontalOverlapRatio(text, item) >= 0.25;
  });
  if (pageTexts.length === 0) {
    return clamp(item.y < 0.2 ? item.y : 0.08, 0.04, 0.86);
  }
  return clamp(Math.min(...pageTexts.map((text) => text.y)), 0.04, 0.86);
}

function pageFlowBottom(pageId: string, item: SourceTextItem): number {
  const pageTexts = (sourceTextItemsByPage.get(pageId) ?? []).filter((text) => {
    return text.reflowable && horizontalOverlapRatio(text, item) >= 0.25;
  });
  const footerCandidates = pageTexts.filter((text) => text.y > 0.88);
  if (footerCandidates.length > 0) {
    return Math.max(0.75, Math.min(...footerCandidates.map((text) => text.y)) - 0.018);
  }
  return 0.94;
}

function flowIdForRect(rect: { x: number; width: number }): string {
  const center = rect.x + rect.width / 2;
  if (center < 0.38) {
    return "left-column";
  }
  if (center > 0.62) {
    return "right-column";
  }
  return "main-column";
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
      offset += crossPageOverflowOffset(annotation);
    } else if (annotation.pageId === sourceText.pageId && isBelowSameFlow(sourceText, annotation)) {
      offset += delta;
    }
  }
  return Math.abs(offset) < 0.002 ? 0 : offset;
}

function crossPageOverflowOffset(annotation: TextAnnotation): number {
  if (!annotation.eraseOriginal || !isReflowSourceAnnotation(annotation)) {
    return 0;
  }
  const sourceText = sourceTextForAnnotation(annotation);
  if (!sourceText) {
    return 0;
  }
  const overflow = annotation.y + annotation.height - pageFlowBottom(annotation.pageId, sourceText);
  return overflow > 0 ? overflow : 0;
}

function sourceTextForAnnotation(annotation: TextAnnotation): SourceTextItem | null {
  if (!annotation.sourceTextId) {
    return null;
  }
  return sourceTextItemsByPage
    .get(annotation.pageId)
    ?.find((sourceText) => sourceText.id === annotation.sourceTextId) ?? null;
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
  const fieldValue = String(raw.fieldValue ?? annotationText(raw));
  const defaultValue = raw.defaultValue == null ? undefined : String(raw.defaultValue);
  const required = Boolean(raw.required);
  const readOnly = Boolean(raw.readOnly);
  if (fieldType === "Sig") {
    return {
      ...base,
      type: "formField",
      fieldName,
      fieldType: "signature",
      fieldValue,
      defaultValue,
      required,
      readOnly: true,
      tabIndex: Number.isFinite(Number(raw.tabIndex)) ? Number(raw.tabIndex) : undefined,
      unsupportedReason: "서명 필드는 가져왔지만 디지털 서명 작성은 아직 지원하지 않습니다.",
      opacity: 1,
      strokeWidth: base.strokeWidth || 1,
    };
  }
  if (fieldType === "Tx") {
    return {
      ...base,
      type: "formField",
      fieldName,
      fieldType: "text",
      fieldValue,
      defaultValue,
      required,
      readOnly,
      tabIndex: Number.isFinite(Number(raw.tabIndex)) ? Number(raw.tabIndex) : undefined,
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
      defaultValue,
      required,
      readOnly,
      tabIndex: Number.isFinite(Number(raw.tabIndex)) ? Number(raw.tabIndex) : undefined,
      opacity: 1,
      strokeWidth: base.strokeWidth || 1,
    };
  }
  if (fieldType === "Btn" && raw.radioButton === true) {
    const exportValue = String(raw.exportValue ?? fieldValue ?? "Yes");
    return {
      ...base,
      type: "formField",
      fieldName,
      fieldType: "radio",
      fieldValue,
      checked: fieldValue !== "" && fieldValue !== "Off",
      exportValue,
      defaultValue,
      required,
      readOnly,
      tabIndex: Number.isFinite(Number(raw.tabIndex)) ? Number(raw.tabIndex) : undefined,
      opacity: 1,
      strokeWidth: base.strokeWidth || 1,
    };
  }
  if (fieldType === "Ch") {
    const options = annotationOptions(raw);
    const isCombo = raw.comboBox === true || raw.combo === true;
    return {
      ...base,
      type: "formField",
      fieldName,
      fieldType: isCombo ? "combo" : "list",
      fieldValue,
      defaultValue,
      required,
      readOnly,
      tabIndex: Number.isFinite(Number(raw.tabIndex)) ? Number(raw.tabIndex) : undefined,
      options,
      opacity: 1,
      strokeWidth: base.strokeWidth || 1,
    };
  }
  return null;
}

function annotationOptions(raw: Record<string, unknown>): string[] {
  const rawOptions = raw.options;
  if (!Array.isArray(rawOptions)) {
    return [];
  }
  return rawOptions
    .map((option) => {
      if (typeof option === "string") {
        return option;
      }
      if (typeof option === "object" && option !== null) {
        const record = option as Record<string, unknown>;
        const displayValue = record.displayValue ?? record.exportValue ?? record.value;
        return typeof displayValue === "string" ? displayValue : "";
      }
      return "";
    })
    .filter(Boolean);
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

function sourceImageItemById(sourceImageItemId: string): SourceImageItem | null {
  for (const items of sourceImageItemsByPage.values()) {
    const match = items.find((item) => item.id === sourceImageItemId);
    if (match) {
      return match;
    }
  }
  return null;
}

function rectChangedFromSourceImage(annotation: Annotation, sourceImage: SourceImageItem): boolean {
  return (
    Math.abs(annotation.x - sourceImage.x) > 0.002 ||
    Math.abs(annotation.y - sourceImage.y) > 0.002 ||
    Math.abs(annotation.width - sourceImage.width) > 0.002 ||
    Math.abs(annotation.height - sourceImage.height) > 0.002
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
    const metrics = metricsForLayer(event.currentTarget) ?? fallbackMetrics(draftState.pageId);
    const point = eventPoint(event, event.currentTarget, metrics);
    draftState.points.push(toRelativePoint(point.x, point.y, metrics));
  }
}

function handleLayerPointerUp(event: PointerEvent): void {
  if (dragState) {
    finishDrag();
    return;
  }
  if (!draftState || !(event.currentTarget instanceof HTMLElement)) {
    return;
  }
  const metrics = metricsForLayer(event.currentTarget) ?? fallbackMetrics(draftState.pageId);
  const point = eventPoint(event, event.currentTarget, metrics);
  const draft = draftState;
  draftState = null;

  if (draft.type === "pen") {
    if (draft.points.length < 2) {
      return;
    }
    const annotation: PenAnnotation = {
      id: crypto.randomUUID(),
      pageId: draft.pageId,
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
    draft.pageId,
    draft.tool as Extract<Tool, "highlight" | "rect" | "redact">,
    left,
    top,
    width,
    height,
    metrics,
  );
}

function cancelDraft(): void {
  draftState = null;
  dragState = null;
}

function addText(pageId: string, x: number, y: number, metrics = fallbackMetrics(pageId)): void {
  const annotation: TextAnnotation = {
    id: crypto.randomUUID(),
    pageId,
    type: "text",
    x: clamp(x / metrics.width, 0, 0.92),
    y: clamp(y / metrics.height, 0, 0.94),
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

function addImage(pageId: string, x: number, y: number, dataUrl: string, metrics = fallbackMetrics(pageId)): void {
  const annotation: ImageAnnotation = {
    id: crypto.randomUUID(),
    pageId,
    type: "image",
    x: clamp(x / metrics.width, 0, 0.75),
    y: clamp(y / metrics.height, 0, 0.75),
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

function addFormField(pageId: string, x: number, y: number, metrics = fallbackMetrics(pageId)): void {
  const annotation: FormFieldAnnotation = {
    id: crypto.randomUUID(),
    pageId,
    type: "formField",
    x: clamp(x / metrics.width, 0, 0.76),
    y: clamp(y / metrics.height, 0, 0.94),
    width: 0.24,
    height: 0.05,
    color: "#172026",
    opacity: 1,
    strokeWidth: 1,
    fieldName: nextFormFieldName("textField"),
    fieldType: "text",
    fieldValue: "",
    defaultValue: "",
    required: false,
    readOnly: false,
    tabIndex: nextFormTabIndex(pageId),
    options: ["Option 1", "Option 2"],
  };
  annotations.push(annotation);
  selectedId = annotation.id;
  currentTool = "select";
  commitHistory();
  renderToolbar();
  renderInspector();
  renderCurrentLayer();
}

function nextFormFieldName(prefix: string): string {
  const names = new Set(
    annotations
      .filter((annotation): annotation is FormFieldAnnotation => annotation.type === "formField")
      .map((annotation) => annotation.fieldName),
  );
  let index = names.size + 1;
  while (names.has(`${prefix}${index}`)) {
    index += 1;
  }
  return `${prefix}${index}`;
}

function nextFormTabIndex(pageId: string): number {
  return annotations.filter((annotation) => annotation.type === "formField" && annotation.pageId === pageId).length + 1;
}

function addBox(
  pageId: string,
  tool: Extract<Tool, "highlight" | "rect" | "redact">,
  x: number,
  y: number,
  width: number,
  height: number,
  metrics = fallbackMetrics(pageId),
): void {
  const annotation: BoxAnnotation = {
    id: crypto.randomUUID(),
    pageId,
    type: tool,
    x: clamp(x / metrics.width, 0, 0.98),
    y: clamp(y / metrics.height, 0, 0.98),
    width: clamp(width / metrics.width, 0.02, 1),
    height: clamp(height / metrics.height, 0.02, 1),
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
  currentPageId = annotation.pageId;
  setActivePageMetrics(annotation.pageId);
  updateCurrentPageIndicators();
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
  currentPageId = annotation.pageId;
  setActivePageMetrics(annotation.pageId);
  updateCurrentPageIndicators();
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
  const metrics = metricsForPage(annotation.pageId) ?? fallbackMetrics(annotation.pageId);
  const deltaX = (event.clientX - dragState.startX) / metrics.width;
  const deltaY = (event.clientY - dragState.startY) / metrics.height;

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
  const layoutWarnings = layoutCollisionWarnings();
  const warningPanel = layoutWarnings.length
    ? `<div class="warning-panel"><strong>저장 차단됨</strong><span>${escapeHtml(layoutWarnings[0])}</span></div>`
    : "";
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
      ${warningPanel}
      ${pageControls}
      <p class="status-line">기존 글씨는 안전 교체 방식으로 편집합니다. 문단 재흐름은 이미지/도표 충돌 검증을 통과해야 저장됩니다.</p>
    `;
    bindDocumentControls();
    bindPageControls();
    return;
  }

  body.innerHTML = `
    ${documentControls}
    ${warningPanel}
    ${pageControls}
    ${selected.type === "text" ? textFields(selected) : ""}
    ${selected.type === "formField" ? renderFormFieldInspector(selected, escapeHtml) : ""}
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
    <div class="field">
      <label class="checkbox-line">
        <input id="sanitizeHiddenInfo" type="checkbox"${sanitizeHiddenInfo ? " checked" : ""} />
        숨은 정보 제거
      </label>
      <p class="status-line">메타데이터, XMP, 첨부파일, 주석/action, JavaScript name tree, 숨은 레이어, 링크, 썸네일을 저장 시 제거합니다.</p>
    </div>
    <div class="mini-actions">
      <button id="preflightButton" type="button">사전 검사</button>
    </div>
    ${lastPreflightReport ? renderPreflightPanel(lastPreflightReport, escapeHtml) : ""}
    <details class="metadata-panel product-tool-panel" open>
      <summary>OCR / 스캔 PDF</summary>
      <div class="field">
        <label>OCR 언어</label>
        <input id="ocrLanguage" type="text" value="${escapeHtml(ocrLanguage)}" />
      </div>
      <div class="mini-actions">
        <button id="ocrStatusButton" type="button">OCR 상태</button>
        <button id="ocrRunButton" type="button">OCR 실행</button>
      </div>
      <div class="field-row">
        <div class="field">
          <label>보정 페이지</label>
          <input id="ocrCorrectionPage" type="number" min="1" step="1" value="${ocrCorrectionPage}" />
        </div>
      </div>
      <div class="field">
        <label>보정 OCR 텍스트</label>
        <textarea id="ocrCorrectionText" placeholder="스캔 페이지에 저장할 검색 가능한 보정 텍스트">${escapeHtml(ocrCorrectionText)}</textarea>
      </div>
      <div class="mini-actions">
        <button id="ocrCorrectButton" type="button">OCR 보정 저장</button>
      </div>
      ${lastOcrStatus ? `<p class="status-line">Tesseract ${escapeHtml(lastOcrStatus.version || "unknown")} · 누락 언어 ${lastOcrStatus.missingLanguages.length}</p>` : ""}
    </details>
    <details class="metadata-panel product-tool-panel" open>
      <summary>인증서 서명 / 보안</summary>
      <div class="mini-actions">
        <button id="selectCertificateButton" type="button">인증서 선택</button>
        <button id="selectCertificateKeyButton" type="button">개인키 선택</button>
      </div>
      <p class="status-line">인증서 ${certificatePem ? "준비됨" : "없음"} · 개인키 ${certificateKeyPem ? "준비됨" : "없음"}</p>
      <div class="field">
        <label>서명자</label>
        <input id="certificateSignerName" type="text" value="${escapeHtml(certificateSignerName)}" />
      </div>
      <div class="field">
        <label>사유</label>
        <input id="certificateReason" type="text" value="${escapeHtml(certificateReason)}" />
      </div>
      <div class="field">
        <label>위치</label>
        <input id="certificateLocation" type="text" value="${escapeHtml(certificateLocation)}" />
      </div>
      <div class="field">
        <label>잠금 정책</label>
        <select id="certificateLockPolicy">
          <option value="none"${certificateLockPolicy === "none" ? " selected" : ""}>잠금 없음</option>
          <option value="noChanges"${certificateLockPolicy === "noChanges" ? " selected" : ""}>변경 금지</option>
          <option value="formFill"${certificateLockPolicy === "formFill" ? " selected" : ""}>양식 작성 허용</option>
          <option value="formFillAnnotate"${certificateLockPolicy === "formFillAnnotate" ? " selected" : ""}>양식/주석 허용</option>
        </select>
      </div>
      <div class="mini-actions">
        <button id="certificateSignButton" type="button">인증서 서명</button>
        <button id="signatureValidateButton" type="button">서명 검증</button>
      </div>
      ${lastSignatureValidation ? signatureValidationSummary(lastSignatureValidation) : ""}
    </details>
    <details class="metadata-panel product-tool-panel" open>
      <summary>접근성 기본 수리</summary>
      <div class="field">
        <label>문서 언어</label>
        <input id="accessibilityLanguage" type="text" value="${escapeHtml(accessibilityLanguage)}" />
      </div>
      <div class="field">
        <label>첫 이미지 대체 텍스트</label>
        <textarea id="accessibilityAltText" placeholder="첫 페이지 첫 이미지에 저장할 alt text">${escapeHtml(accessibilityAltText)}</textarea>
      </div>
      <div class="mini-actions">
        <button id="accessibilityRepairButton" type="button">접근성 수리 저장</button>
      </div>
      <p class="status-line">PDF/UA 완전 검증이 아니라 제목, 언어, 태그 신호, 탭 순서, 이미지 alt text 기본 수리입니다.</p>
    </details>
    <details class="metadata-panel product-tool-panel" open>
      <summary>비교 / 배치 자동화</summary>
      <div class="mini-actions">
        <button id="selectCompareButton" type="button">비교 PDF 선택</button>
        <button id="compareRunButton" type="button">비교 실행</button>
      </div>
      <p class="status-line">비교 대상 ${compareFileName ? escapeHtml(compareFileName) : "없음"}</p>
      ${lastCompareResult ? compareResultSummary(lastCompareResult) : ""}
      <div class="field">
        <label>배치 워터마크 텍스트</label>
        <input id="batchWatermarkText" type="text" value="${escapeHtml(batchWatermarkText)}" />
      </div>
      <div class="field">
        <label>배치 검색 가리기 텍스트</label>
        <input id="batchRedactText" type="text" value="${escapeHtml(batchRedactText)}" placeholder="예: SECRET" />
      </div>
      <div class="field">
        <label class="checkbox-line">
          <input id="batchSanitizeHiddenInfo" type="checkbox"${batchSanitizeHiddenInfo ? " checked" : ""} />
          배치에서 숨은 정보 제거
        </label>
      </div>
      <div class="mini-actions">
        <button id="batchRunButton" type="button">현재 PDF 배치 실행</button>
      </div>
      ${lastBatchResult ? batchResultSummary(lastBatchResult) : ""}
    </details>
    <details class="metadata-panel" open>
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

function signatureValidationSummary(report: SignatureValidation): string {
  const verifiedCount = report.signatures.filter((signature) => signature.cmsVerified).length;
  const lockPolicy = report.signatures.find((signature) => signature.lockPolicy)?.lockPolicy ?? "none";
  const errors = [...report.errors, ...report.signatures.flatMap((signature) => signature.errors)].filter(Boolean);
  return `
    <div class="preflight-panel">
      <strong>서명 검증</strong>
      <small>${report.signatureCount}개 서명 · ${verifiedCount}개 CMS 검증 · DocMDP ${escapeHtml(lockPolicy)}</small>
      ${errors.length ? `<ul>${errors.slice(0, 4).map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>` : "<p>서명 ByteRange와 CMS 검증을 통과했습니다.</p>"}
    </div>
  `;
}

function compareResultSummary(report: CompareResult): string {
  const changedPages = report.changedPages.map((pageIndex) => pageIndex + 1).join(", ") || "없음";
  const firstTextChange = report.textChanges[0];
  return `
    <div class="preflight-panel">
      <strong>비교 결과</strong>
      <small>${report.leftPageCount}쪽 ↔ ${report.rightPageCount}쪽 · 변경 ${report.changedPageCount}쪽</small>
      <p>변경 페이지: ${escapeHtml(changedPages)}</p>
      ${firstTextChange ? `<p>첫 텍스트 변경: ${escapeHtml(firstTextChange.leftPreview.slice(0, 80))} → ${escapeHtml(firstTextChange.rightPreview.slice(0, 80))}</p>` : ""}
      ${report.errors.length ? `<ul>${report.errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>` : ""}
    </div>
  `;
}

function batchResultSummary(report: BatchResult): string {
  const firstError = report.jobs.find((job) => !job.ok)?.error;
  return `
    <div class="preflight-panel">
      <strong>배치 결과</strong>
      <small>${report.successCount}/${report.jobCount} 성공 · 실패 ${report.failureCount}</small>
      ${firstError ? `<p>${escapeHtml(firstError)}</p>` : "<p>현재 PDF 배치 결과를 PDF 구조에 저장했습니다.</p>"}
    </div>
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
  bindCommandButton("movePageUp", "move-page-up");
  bindCommandButton("movePageDown", "move-page-down");
  bindCommandButton("rotatePage", "rotate-page");
  bindCommandButton("duplicatePage", "duplicate-page");
  bindCommandButton("extractPage", "extract-page");
  bindCommandButton("deletePage", "delete-page");
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
  const sanitizeField = document.querySelector<HTMLInputElement>("#sanitizeHiddenInfo");
  sanitizeField?.addEventListener("change", () => {
    sanitizeHiddenInfo = sanitizeField.checked;
    lastPreflightReport = null;
    commitHistory();
  });
  bindCommandButton("preflightButton", "preflight-pdf");
  bindDocumentToolFields();
  bindCommandButton("ocrStatusButton", "ocr-status");
  bindCommandButton("ocrRunButton", "ocr-run");
  bindCommandButton("ocrCorrectButton", "ocr-correct");
  bindCommandButton("accessibilityRepairButton", "accessibility-repair");
  bindCommandButton("certificateSignButton", "certificate-sign");
  bindCommandButton("signatureValidateButton", "signature-validate");
  bindCommandButton("compareRunButton", "compare-run");
  bindCommandButton("batchRunButton", "batch-run");
  byId<HTMLButtonElement>("selectCertificateButton")?.addEventListener("click", () => dom.certificateInput.click());
  byId<HTMLButtonElement>("selectCertificateKeyButton")?.addEventListener("click", () => dom.certificateKeyInput.click());
  byId<HTMLButtonElement>("selectCompareButton")?.addEventListener("click", () => dom.compareInput.click());
}

function bindDocumentToolFields(): void {
  const ocrLanguageField = document.querySelector<HTMLInputElement>("#ocrLanguage");
  ocrLanguageField?.addEventListener("change", () => {
    ocrLanguage = ocrLanguageField.value.trim() || "eng";
    renderInspector();
  });
  const ocrCorrectionPageField = document.querySelector<HTMLInputElement>("#ocrCorrectionPage");
  ocrCorrectionPageField?.addEventListener("change", () => {
    const value = Number(ocrCorrectionPageField.value);
    ocrCorrectionPage = Number.isFinite(value) && value > 0 ? Math.round(value) : 1;
    renderInspector();
  });
  const ocrCorrectionTextField = document.querySelector<HTMLTextAreaElement>("#ocrCorrectionText");
  ocrCorrectionTextField?.addEventListener("input", () => {
    ocrCorrectionText = ocrCorrectionTextField.value;
    syncCommandButtons();
  });
  const accessibilityLanguageField = document.querySelector<HTMLInputElement>("#accessibilityLanguage");
  accessibilityLanguageField?.addEventListener("change", () => {
    accessibilityLanguage = accessibilityLanguageField.value.trim() || "en-US";
  });
  const accessibilityAltTextField = document.querySelector<HTMLTextAreaElement>("#accessibilityAltText");
  accessibilityAltTextField?.addEventListener("input", () => {
    accessibilityAltText = accessibilityAltTextField.value;
  });
  const certificateSignerNameField = document.querySelector<HTMLInputElement>("#certificateSignerName");
  certificateSignerNameField?.addEventListener("change", () => {
    certificateSignerName = certificateSignerNameField.value.trim() || "PDFeditor signer";
  });
  const certificateReasonField = document.querySelector<HTMLInputElement>("#certificateReason");
  certificateReasonField?.addEventListener("change", () => {
    certificateReason = certificateReasonField.value.trim();
  });
  const certificateLocationField = document.querySelector<HTMLInputElement>("#certificateLocation");
  certificateLocationField?.addEventListener("change", () => {
    certificateLocation = certificateLocationField.value.trim();
  });
  const certificateLockPolicyField = document.querySelector<HTMLSelectElement>("#certificateLockPolicy");
  certificateLockPolicyField?.addEventListener("change", () => {
    certificateLockPolicy = certificateLockPolicyField.value as typeof certificateLockPolicy;
  });
  const batchWatermarkTextField = document.querySelector<HTMLInputElement>("#batchWatermarkText");
  batchWatermarkTextField?.addEventListener("input", () => {
    batchWatermarkText = batchWatermarkTextField.value;
    syncCommandButtons();
  });
  const batchRedactTextField = document.querySelector<HTMLInputElement>("#batchRedactText");
  batchRedactTextField?.addEventListener("input", () => {
    batchRedactText = batchRedactTextField.value;
    syncCommandButtons();
  });
  const batchSanitizeHiddenInfoField = document.querySelector<HTMLInputElement>("#batchSanitizeHiddenInfo");
  batchSanitizeHiddenInfoField?.addEventListener("change", () => {
    batchSanitizeHiddenInfo = batchSanitizeHiddenInfoField.checked;
    syncCommandButtons();
  });
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

  const formValue = document.querySelector<HTMLInputElement | HTMLSelectElement>("#formValue");
  formValue?.addEventListener("change", () => {
    if (
      annotation.type === "formField" &&
      annotation.fieldType !== "checkbox" &&
      annotation.fieldType !== "radio" &&
      annotation.fieldType !== "signature"
    ) {
      annotation.fieldValue = formValue.value;
      markAnnotationDirty(annotation);
      commitHistory();
      renderInspector();
      renderCurrentLayer();
    }
  });

  const formName = document.querySelector<HTMLInputElement>("#formName");
  formName?.addEventListener("change", () => {
    if (annotation.type === "formField" && !annotation.sourceAnnotationId) {
      annotation.fieldName = formName.value.trim() || nextFormFieldName("field");
      commitHistory();
      renderInspector();
      renderCurrentLayer();
    }
  });

  const formType = document.querySelector<HTMLSelectElement>("#formType");
  formType?.addEventListener("change", () => {
    if (annotation.type === "formField" && !annotation.sourceAnnotationId) {
      setNewFormFieldType(annotation, formType.value as FormFieldAnnotation["fieldType"]);
      commitHistory();
      renderInspector();
      renderCurrentLayer();
    }
  });

  const formOptions = document.querySelector<HTMLTextAreaElement>("#formOptions");
  formOptions?.addEventListener("change", () => {
    if (annotation.type === "formField" && (annotation.fieldType === "combo" || annotation.fieldType === "list")) {
      annotation.options = formOptions.value
        .split(/\r?\n/)
        .map((option) => option.trim())
        .filter(Boolean);
      if (annotation.options.length && !annotation.options.includes(annotation.fieldValue)) {
        annotation.fieldValue = annotation.options[0];
      }
      commitHistory();
      renderInspector();
      renderCurrentLayer();
    }
  });

  const formChecked = document.querySelector<HTMLInputElement>("#formChecked");
  formChecked?.addEventListener("change", () => {
    if (annotation.type === "formField" && (annotation.fieldType === "checkbox" || annotation.fieldType === "radio")) {
      setFormFieldChecked(annotation, formChecked.checked);
      markAnnotationDirty(annotation);
      commitHistory();
      renderInspector();
      renderCurrentLayer();
    }
  });

  const formRequired = document.querySelector<HTMLInputElement>("#formRequired");
  formRequired?.addEventListener("change", () => {
    if (annotation.type === "formField" && annotation.fieldType !== "signature") {
      annotation.required = formRequired.checked;
      markAnnotationDirty(annotation);
      commitHistory();
      renderInspector();
      renderCurrentLayer();
    }
  });

  const formDefaultValue = document.querySelector<HTMLInputElement>("#formDefaultValue");
  formDefaultValue?.addEventListener("change", () => {
    if (annotation.type === "formField" && annotation.fieldType !== "signature") {
      annotation.defaultValue = formDefaultValue.value;
      markAnnotationDirty(annotation);
      commitHistory();
      renderInspector();
      renderCurrentLayer();
    }
  });

  const formTabIndex = document.querySelector<HTMLInputElement>("#formTabIndex");
  formTabIndex?.addEventListener("change", () => {
    if (annotation.type === "formField" && annotation.fieldType !== "signature") {
      const value = Number(formTabIndex.value);
      annotation.tabIndex = Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
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

function layoutCollisionWarnings(): string[] {
  const warnings: string[] = [];
  const plan = semanticReflowPlan();
  warnings.push(...plan.unresolvedCollisions);
  const textRects = editableFlowTextRects();
  for (const textRect of textRects) {
    if (textRect.y + textRect.height > 0.99) {
      warnings.push(`${textRect.label} 텍스트가 페이지 하단을 넘습니다.`);
      continue;
    }
    for (const image of sourceImageItemsByPage.get(textRect.pageId) ?? []) {
      if (isSourceImageAlreadyEdited(image.id)) {
        continue;
      }
      const overlap = normalizedOverlapAreaRatio(textRect, image);
      const baselineOverlap = normalizedOverlapAreaRatio(
        {
          x: textRect.baselineX,
          y: textRect.baselineY,
          width: textRect.baselineWidth,
          height: textRect.baselineHeight,
        },
        image,
      );
      if (overlap > 0.01 && overlap > baselineOverlap + 0.01) {
        warnings.push(`${textRect.label} 텍스트가 이미지/도표 영역과 겹칩니다.`);
        break;
      }
    }
  }
  return warnings;
}

function editableFlowTextRects(): Array<{
  pageId: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  baselineX: number;
  baselineY: number;
  baselineWidth: number;
  baselineHeight: number;
}> {
  const rects = annotations
    .filter((annotation): annotation is TextAnnotation => annotation.type === "text")
    .filter((annotation) => Boolean(annotation.sourceTextId || annotation.reflowable))
    .map((annotation) => ({
      pageId: annotation.pageId,
      label: annotation.sourceTextId ? "기존 글씨 편집" : "문단 재흐름",
      x: annotation.x,
      y: annotation.y,
      width: annotation.width,
      height: annotation.height,
      baselineX: annotation.eraseOriginal?.x ?? annotation.x,
      baselineY: annotation.eraseOriginal?.y ?? annotation.y,
      baselineWidth: annotation.eraseOriginal?.width ?? annotation.width,
      baselineHeight: annotation.eraseOriginal?.height ?? annotation.height,
    }));

  for (const items of sourceTextItemsByPage.values()) {
    for (const item of items) {
      if (isSourceTextAlreadyEdited(item.id)) {
        continue;
      }
      const target = semanticReflowTarget(item);
      if (!target) {
        continue;
      }
      rects.push({
        pageId: target.pageId,
        label: "연쇄 재배치",
        x: item.x,
        y: target.y,
        width: item.width,
        height: item.height,
        baselineX: item.x,
        baselineY: item.y,
        baselineWidth: item.width,
        baselineHeight: item.height,
      });
    }
  }

  return rects;
}

function normalizedOverlapAreaRatio(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): number {
  const xOverlap = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const yOverlap = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  if (xOverlap <= 0 || yOverlap <= 0) {
    return 0;
  }
  return (xOverlap * yOverlap) / Math.max(0.0001, left.width * left.height);
}

async function exportPdf(): Promise<void> {
  if (!originalBytes || !pdfDocument) {
    showToast("먼저 PDF를 열어주세요.");
    return;
  }
  const layoutWarnings = layoutCollisionWarnings();
  if (layoutWarnings.length > 0) {
    showToast(`레이아웃 충돌: ${layoutWarnings[0]}`);
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

async function runPreflightCheck(): Promise<void> {
  if (!originalBytes || !pdfDocument) {
    showToast("먼저 PDF를 열어주세요.");
    return;
  }
  let bytes: Uint8Array;
  try {
    bytes = await buildExportPdfBytes();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "사전 검사할 PDF를 만들 수 없습니다.");
    return;
  }
  const report = await preflightPdfWithEngine(bytes);
  if (!report) {
    showToast("PDF 엔진 사전 검사를 실행할 수 없습니다. npm run engine:serve를 확인하세요.");
    return;
  }
  lastPreflightReport = report;
  renderInspector();
  showToast(report.warnings.length ? `사전 검사 경고 ${report.warnings.length}개` : "사전 검사 통과");
}

async function runOcrStatusCheck(): Promise<void> {
  lastOcrStatus = await getOcrStatusWithEngine(ocrLanguage);
  renderInspector();
  if (!lastOcrStatus) {
    showToast("OCR 엔진 상태를 확인할 수 없습니다.");
    return;
  }
  showToast(lastOcrStatus.ok ? "OCR 런타임을 사용할 수 있습니다." : `OCR 누락: ${lastOcrStatus.errors.join(", ")}`);
}

async function runOcrOnDocument(): Promise<void> {
  if (!originalBytes || !pdfDocument) {
    showToast("먼저 PDF를 열어주세요.");
    return;
  }
  const bytes = await ocrPdfWithEngine({
    bytes: originalBytes,
    password: openPassword,
    language: ocrLanguage,
    pages: "all",
    dpi: 220,
    force: true,
  });
  if (!bytes) {
    showToast("OCR PDF를 만들 수 없습니다. OCR 엔진 상태를 확인하세요.");
    return;
  }
  await validateExportedPdf(bytes, pageItems.length);
  await loadPdfBytes(bytes, withSuffix(fileName, "ocr"), "OCR 검색 레이어를 PDF 구조에 저장했습니다.");
  downloadPdf(bytes, "OCR 검색 가능 PDF를 저장했습니다.");
}

async function correctOcrOnDocument(): Promise<void> {
  if (!originalBytes || !pdfDocument) {
    showToast("먼저 PDF를 열어주세요.");
    return;
  }
  const text = ocrCorrectionText.trim();
  if (!text) {
    showToast("보정할 OCR 텍스트를 입력하세요.");
    return;
  }
  const pageIndex = clamp(Math.round(ocrCorrectionPage) - 1, 0, Math.max(0, pageItems.length - 1));
  const bytes = await correctOcrPdfWithEngine({
    bytes: originalBytes,
    password: openPassword,
    dpi: 220,
    corrections: [
      {
        pageIndex,
        x: 0.06,
        y: 0.06,
        width: 0.88,
        height: 0.16,
        text,
        fontSize: 12,
      },
    ],
  });
  if (!bytes) {
    showToast("OCR 보정 PDF를 만들 수 없습니다.");
    return;
  }
  await validateExportedPdf(bytes, pageItems.length);
  await loadPdfBytes(bytes, withSuffix(fileName, "ocr-corrected"), "보정 OCR 텍스트를 검색 가능한 PDF 구조에 저장했습니다.");
  downloadPdf(bytes, "OCR 보정 PDF를 저장했습니다.");
}

async function repairAccessibilityOnDocument(): Promise<void> {
  if (!originalBytes || !pdfDocument) {
    showToast("먼저 PDF를 열어주세요.");
    return;
  }
  const bytes = await repairAccessibilityWithEngine({
    bytes: originalBytes,
    password: openPassword,
    title: documentMetadata.title || fileName.replace(/\.pdf$/i, ""),
    language: accessibilityLanguage,
    altTexts: accessibilityAltText.trim()
      ? [{ pageIndex: 0, imageIndex: 0, altText: accessibilityAltText.trim() }]
      : [],
  });
  if (!bytes) {
    showToast("접근성 기본 수리를 저장할 수 없습니다.");
    return;
  }
  await validateExportedPdf(bytes, pageItems.length);
  await loadPdfBytes(bytes, withSuffix(fileName, "accessible"), "접근성 기본 수리를 PDF 구조에 저장했습니다.");
  downloadPdf(bytes, "접근성 기본 수리 PDF를 저장했습니다.");
}

async function signDocumentWithCertificate(): Promise<void> {
  if (!originalBytes || !pdfDocument) {
    showToast("먼저 PDF를 열어주세요.");
    return;
  }
  if (!certificatePem || !certificateKeyPem) {
    showToast("PEM 인증서와 개인키를 먼저 선택하세요.");
    return;
  }
  let bytes: Uint8Array;
  try {
    bytes = await buildExportPdfBytes();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "서명할 PDF를 만들 수 없습니다.");
    return;
  }
  const signed = await signPdfWithCertificate({
    bytes,
    certPem: certificatePem,
    keyPem: certificateKeyPem,
    password: openPassword,
    fieldName: "PDFeditorSignature",
    signerName: certificateSignerName,
    reason: certificateReason,
    location: certificateLocation,
    pageIndex: Math.max(0, pageItems.findIndex((item) => item.id === currentPageId)),
    rect: { x: 72, y: 72, width: 180, height: 48 },
    lockPolicy: certificateLockPolicy,
  });
  if (!signed) {
    showToast("인증서 서명에 실패했습니다.");
    return;
  }
  lastSignatureValidation = await validateSignatureWithEngine(signed);
  await loadPdfBytes(signed, withSuffix(fileName, "signed"), "인증서 서명을 PDF 구조에 저장했습니다.");
  lastSignatureValidation = await validateSignatureWithEngine(signed);
  renderInspector();
  downloadPdf(signed, "인증서 서명 PDF를 저장했습니다.");
}

async function validateCurrentSignature(): Promise<void> {
  if (!originalBytes || !pdfDocument) {
    showToast("먼저 PDF를 열어주세요.");
    return;
  }
  lastSignatureValidation = await validateSignatureWithEngine(originalBytes);
  renderInspector();
  if (!lastSignatureValidation) {
    showToast("서명 검증을 실행할 수 없습니다.");
    return;
  }
  showToast(lastSignatureValidation.ok ? "서명 검증을 통과했습니다." : "서명 검증 실패 또는 서명 없음.");
}

async function runCompareWithSelectedPdf(): Promise<void> {
  if (!originalBytes || !pdfDocument || !compareBytes) {
    showToast("현재 PDF와 비교할 PDF를 먼저 선택하세요.");
    return;
  }
  let leftBytes: Uint8Array;
  try {
    leftBytes = await buildExportPdfBytes();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "비교할 현재 PDF를 만들 수 없습니다.");
    return;
  }
  const result = await comparePdfWithEngine(leftBytes, compareBytes, true);
  if (!result) {
    showToast("PDF 비교 엔진을 사용할 수 없습니다.");
    return;
  }
  lastCompareResult = result;
  renderInspector();
  if (result.reportBase64) {
    downloadNamedPdf(
      base64ToBytes(result.reportBase64),
      withSuffix(fileName, "compare-report"),
      `비교 완료: ${result.changedPageCount}쪽 변경, 보고서 PDF를 저장했습니다.`,
    );
    return;
  }
  showToast(result.ok ? `비교 완료: ${result.changedPageCount}쪽 변경` : "PDF 비교 실패");
}

async function runBatchQuickAction(): Promise<void> {
  if (!originalBytes || !pdfDocument) {
    showToast("먼저 PDF를 열어주세요.");
    return;
  }
  const layoutWarnings = layoutCollisionWarnings();
  if (layoutWarnings.length > 0) {
    showToast(`레이아웃 충돌: ${layoutWarnings[0]}`);
    return;
  }
  const payload = buildBatchPayload(originalBytes);
  const result = await batchPdfWithEngine([
    {
      fileName,
      bytes: originalBytes,
      payload,
    },
  ]);
  if (!result) {
    showToast("배치 엔진을 사용할 수 없습니다.");
    return;
  }
  lastBatchResult = result;
  const firstJob = result.jobs[0];
  if (!result.ok || !firstJob?.pdfBase64) {
    renderInspector();
    showToast(firstJob?.error || "배치 작업이 실패했습니다.");
    return;
  }
  const editedBytes = base64ToBytes(firstJob.pdfBase64);
  await loadPdfBytes(editedBytes, withSuffix(fileName, "batch"), "배치 작업 결과를 PDF 구조에 적용했습니다.");
  lastBatchResult = result;
  renderInspector();
  downloadPdf(editedBytes, "배치 결과 PDF를 저장했습니다.");
}

function buildBatchPayload(bytes: Uint8Array): EnginePayload {
  const payload = buildEnginePayload(bytes);
  const operations = [...payload.operations];
  const watermarkText = batchWatermarkText.trim();
  if (watermarkText) {
    for (let pageIndex = 0; pageIndex < pageItems.length; pageIndex += 1) {
      operations.push({
        type: "text",
        pageIndex,
        x: 0.07,
        y: 0.04,
        width: 0.86,
        height: 0.04,
        text: watermarkText,
        fontSize: 12,
        color: "#295BDB",
        opacity: 0.75,
        strokeWidth: 1,
        lineHeight: 1.2,
      });
    }
  }
  const redactText = batchRedactText.trim();
  if (redactText) {
    for (let pageIndex = 0; pageIndex < pageItems.length; pageIndex += 1) {
      operations.push({
        type: "redactSearch",
        pageIndex,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        text: redactText,
        color: "#ffffff",
        opacity: 1,
        strokeWidth: 0,
        caseSensitive: false,
      });
    }
  }
  payload.operations = operations;
  if (batchSanitizeHiddenInfo || sanitizeHiddenInfo) {
    payload.saveOptions = buildEngineSaveOptions({
      saveMode,
      redactionMode,
      sanitizeHiddenInfo: true,
    });
  }
  return payload;
}

async function buildExportPdfBytes(): Promise<Uint8Array> {
  if (!originalBytes || !pdfDocument) {
    throw new Error("PDF is not loaded.");
  }
  const layoutWarnings = layoutCollisionWarnings();
  if (layoutWarnings.length > 0) {
    throw new Error(`레이아웃 충돌: ${layoutWarnings[0]}`);
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
    sanitizeHiddenInfo ||
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
  return applyPdfWithEngine(payload);
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
    saveOptions: buildEngineSaveOptions({ saveMode, redactionMode, sanitizeHiddenInfo }),
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
    if (layoutFlowSlicesForPage(pageId).length > 0) {
      continue;
    }
    for (const item of items) {
      if (isSourceTextAlreadyEdited(item.id)) {
        continue;
      }
      const target = semanticReflowTarget(item);
      if (!target) {
        continue;
      }
      const sourcePageIndex = pageIndexById.get(pageId);
      const targetPageIndex = pageIndexById.get(target.pageId);
      if (sourcePageIndex === undefined || targetPageIndex === undefined) {
        continue;
      }
      if (target.pageId !== pageId) {
        operations.push({
          type: "redact",
          pageIndex: sourcePageIndex,
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          color: "#ffffff",
          opacity: 1,
          strokeWidth: 0,
        });
      }
      operations.push({
        type: "text",
        pageIndex: targetPageIndex,
        x: item.x,
        y: target.y,
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
        eraseOriginal: target.pageId === pageId
          ? {
              x: item.x,
              y: item.y,
              width: item.width,
              height: item.height,
            }
          : undefined,
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
    const sourceImage = sourceImageItemById(annotation.sourceImageId);
    if (sourceImage && rectChangedFromSourceImage(annotation, sourceImage)) {
      return {
        ...base,
        type: "moveImage",
        sourceImageId: sourceImage.sourceImageId,
        eraseOriginal: {
          x: sourceImage.x,
          y: sourceImage.y,
          width: sourceImage.width,
          height: sourceImage.height,
        },
      };
    }
    return {
      ...base,
      type: "deleteImage",
      sourceImageId: sourceImage?.sourceImageId ?? annotation.sourceImageId,
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
      sourceAnnotationId: annotation.sourceAnnotationId,
      create: !annotation.sourceAnnotationId,
      fieldName: annotation.fieldName,
      fieldType: annotation.fieldType,
      fieldValue: annotation.fieldValue,
      checked: annotation.checked,
      exportValue: annotation.exportValue,
      defaultValue: annotation.defaultValue,
      required: annotation.required,
      readOnly: annotation.readOnly,
      tabIndex: annotation.tabIndex,
      options: annotation.options,
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

  engineValidation = await validatePdfWithEngine(bytes);
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
  downloadNamedPdf(bytes, fileName, message);
}

function downloadNamedPdf(bytes: Uint8Array, name: string, message: string): void {
  const stableBytes = new Uint8Array(bytes);
  const blob = new Blob([stableBytes.buffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  showToast(message);
}

function withSuffix(name: string, suffix: string): string {
  return `${name.replace(/\.pdf$/i, "").replace(/-(edited|ocr|ocr-corrected|accessible|signed)$/i, "")}-${suffix}.pdf`;
}

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read file")));
    reader.readAsText(file);
  });
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
  const metrics = metricsForPage(annotation.pageId) ?? activePageMetrics;
  const pdfPageWidth = metrics ? metrics.width / zoom : 612;
  const pdfPageHeight = metrics ? metrics.height / zoom : 792;
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
    sanitizeHiddenInfo,
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
  sanitizeHiddenInfo = snapshot.sanitizeHiddenInfo ?? false;
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

function eventPoint(event: PointerEvent, layer: HTMLElement, metrics = metricsForLayer(layer)): { x: number; y: number } {
  const rect = layer.getBoundingClientRect();
  const width = metrics?.width ?? rect.width;
  const height = metrics?.height ?? rect.height;
  return {
    x: clamp(event.clientX - rect.left, 0, width),
    y: clamp(event.clientY - rect.top, 0, height),
  };
}

function toRelativePoint(x: number, y: number, metrics: PageMetrics): Point {
  return {
    x: clamp(x / metrics.width, 0, 1),
    y: clamp(y / metrics.height, 0, 1),
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
