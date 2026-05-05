import type { ExportValidation, PreflightReport } from "./types";

export function isPreflightReport(value: unknown): value is PreflightReport {
  if (!value || typeof value !== "object") {
    return false;
  }
  const report = value as Partial<PreflightReport>;
  return typeof report.ok === "boolean" && typeof report.pageCount === "number" && Array.isArray(report.warnings);
}

export function validationPreflightFallback(validation: ExportValidation): PreflightReport {
  return {
    ok: validation.ok,
    warnings: validation.errors,
    pageCount: validation.pageCount,
    metadataPresent: false,
    xmpPresent: false,
    embeddedFileCount: 0,
    javascriptCount: 0,
    javascriptNameTreeCount: 0,
    formFieldCount: 0,
    signatureFieldCount: 0,
    xfaPresent: false,
    explicitTabOrderPageCount: 0,
    fontCount: 0,
    hiddenLayerCount: 0,
    commentAnnotationCount: validation.annotationCount ?? 0,
    fileAttachmentAnnotationCount: 0,
    annotationActionCount: 0,
    linkActionCount: 0,
    embeddedSearchIndexCount: 0,
    staleIncrementalSaveCount: 0,
    unreferencedObjectSignalCount: 0,
    pdfaClaim: "",
    pdfxClaim: "",
    outputIntentCount: 0,
  };
}

export function summarizePreflightReport(report: PreflightReport) {
  const extraFindings = [
    report.hiddenLayerCount ? `${report.hiddenLayerCount} hidden layer/OCG` : "",
    report.commentAnnotationCount ? `${report.commentAnnotationCount} comment annotation` : "",
    report.fileAttachmentAnnotationCount ? `${report.fileAttachmentAnnotationCount} file attachment annotation` : "",
    report.annotationActionCount ? `${report.annotationActionCount} annotation action` : "",
    report.linkActionCount ? `${report.linkActionCount} link action` : "",
    report.javascriptNameTreeCount ? `${report.javascriptNameTreeCount} JavaScript name tree` : "",
    report.embeddedSearchIndexCount ? `${report.embeddedSearchIndexCount} embedded search index signal` : "",
    report.staleIncrementalSaveCount ? `${report.staleIncrementalSaveCount} stale incremental save` : "",
    report.unreferencedObjectSignalCount ? `${report.unreferencedObjectSignalCount} unreferenced object signal` : "",
    report.xfaPresent ? "XFA form detected" : "",
    report.signatureFieldCount ? `${report.signatureFieldCount} signature field` : "",
    report.explicitTabOrderPageCount ? `${report.explicitTabOrderPageCount} page with explicit tab order` : "",
    report.pdfaClaim ? `${report.pdfaClaim} claim` : "",
    report.pdfxClaim ? `${report.pdfxClaim} claim` : "",
    report.outputIntentCount ? `${report.outputIntentCount} output intent` : "",
  ].filter(Boolean);

  return {
    status: report.ok ? "통과" : "주의 필요",
    findings: extraFindings,
  };
}
