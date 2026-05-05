import { base64ToBytes, bytesToBase64 } from "../base64";
import { isPreflightReport, validationPreflightFallback } from "../preflightReport";
import type {
  AccessibilityRepairRequest,
  BatchJobRequest,
  BatchResult,
  CertificateSignRequest,
  CompareResult,
  EngineApplyResponse,
  EnginePayload,
  ExportValidation,
  OcrCorrectionRequest,
  OcrRequest,
  OcrStatus,
  PreflightFixupResponse,
  PreflightReport,
  SignatureValidation,
} from "../types";

export function buildEngineEndpoints(apiPath = "/api/pdf/apply"): string[] {
  const sameOriginEndpoint = `${window.location.origin}${apiPath}`;
  const localEngineEndpoint = `http://127.0.0.1:8787${apiPath}`;
  const isLocalDevelopment = ["127.0.0.1", "localhost"].includes(window.location.hostname);
  return !isLocalDevelopment || sameOriginEndpoint === localEngineEndpoint
    ? [sameOriginEndpoint]
    : [sameOriginEndpoint, localEngineEndpoint];
}

export async function applyPdfWithEngine(payload: EnginePayload): Promise<Uint8Array | null> {
  const endpoints = buildEngineEndpoints();
  for (const endpoint of endpoints) {
    try {
      const response = await postJson(endpoint, payload);
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

export async function preflightPdfWithEngine(bytes: Uint8Array): Promise<PreflightReport | null> {
  const endpoints = buildEngineEndpoints("/api/pdf/preflight");
  for (const endpoint of endpoints) {
    try {
      const response = await postPdfBytes(endpoint, bytes);
      if (!response.ok) {
        continue;
      }
      const result: unknown = await response.json();
      if (isPreflightReport(result)) {
        return result;
      }
    } catch (error) {
      console.warn(`PDF engine preflight failed at ${endpoint}`, error);
    }
  }
  const validation = await validatePdfWithEngine(bytes);
  if (!validation) {
    return null;
  }
  const fallback = validationPreflightFallback(validation);
  if (fallback.warnings.length === 0) {
    fallback.warnings.push("전체 사전 검사 endpoint를 사용할 수 없어 구조 검증만 실행했습니다.");
  }
  return fallback;
}

export async function preflightFixupPdfWithEngine(bytes: Uint8Array, targetProfile = "pdfx-3"): Promise<PreflightFixupResponse | null> {
  const endpoints = buildEngineEndpoints("/api/pdf/preflight-fixup");
  for (const endpoint of endpoints) {
    try {
      const response = await postJson(endpoint, {
        pdfBase64: bytesToBase64(bytes),
        targetProfile,
      });
      if (!response.ok) {
        continue;
      }
      const result: unknown = await response.json();
      if (isPreflightFixupResponse(result)) {
        return result;
      }
    } catch (error) {
      console.warn(`PDF engine preflight fixup failed at ${endpoint}`, error);
    }
  }
  return null;
}

export async function getOcrStatusWithEngine(language = "eng"): Promise<OcrStatus | null> {
  const endpoints = buildEngineEndpoints("/api/pdf/ocr-status");
  for (const endpoint of endpoints) {
    try {
      const response = await postJson(endpoint, { language });
      if (!response.ok) {
        continue;
      }
      const result: unknown = await response.json();
      if (isOcrStatus(result)) {
        return result;
      }
    } catch (error) {
      console.warn(`PDF engine OCR status failed at ${endpoint}`, error);
    }
  }
  return null;
}

export async function ocrPdfWithEngine(request: OcrRequest): Promise<Uint8Array | null> {
  const endpoints = buildEngineEndpoints("/api/pdf/ocr");
  for (const endpoint of endpoints) {
    try {
      const response = await postJson(endpoint, {
        ...request,
        pdfBase64: bytesToBase64(request.bytes),
        bytes: undefined,
      });
      if (!response.ok) {
        continue;
      }
      const result: unknown = await response.json();
      if (isEngineApplyResponse(result)) {
        return base64ToBytes(result.pdfBase64);
      }
    } catch (error) {
      console.warn(`PDF engine OCR failed at ${endpoint}`, error);
    }
  }
  return null;
}

export async function correctOcrPdfWithEngine(request: OcrCorrectionRequest): Promise<Uint8Array | null> {
  const endpoints = buildEngineEndpoints("/api/pdf/ocr-correct");
  for (const endpoint of endpoints) {
    try {
      const response = await postJson(endpoint, {
        ...request,
        pdfBase64: bytesToBase64(request.bytes),
        bytes: undefined,
      });
      if (!response.ok) {
        continue;
      }
      const result: unknown = await response.json();
      if (isEngineApplyResponse(result)) {
        return base64ToBytes(result.pdfBase64);
      }
    } catch (error) {
      console.warn(`PDF engine OCR correction failed at ${endpoint}`, error);
    }
  }
  return null;
}

export async function repairAccessibilityWithEngine(request: AccessibilityRepairRequest): Promise<Uint8Array | null> {
  const endpoints = buildEngineEndpoints("/api/pdf/accessibility-repair");
  for (const endpoint of endpoints) {
    try {
      const response = await postJson(endpoint, {
        ...request,
        pdfBase64: bytesToBase64(request.bytes),
        bytes: undefined,
      });
      if (!response.ok) {
        continue;
      }
      const result: unknown = await response.json();
      if (isEngineApplyResponse(result)) {
        return base64ToBytes(result.pdfBase64);
      }
    } catch (error) {
      console.warn(`PDF engine accessibility repair failed at ${endpoint}`, error);
    }
  }
  return null;
}

export async function signPdfWithCertificate(request: CertificateSignRequest): Promise<Uint8Array | null> {
  const endpoints = buildEngineEndpoints("/api/pdf/cert-sign");
  for (const endpoint of endpoints) {
    try {
      const response = await postJson(endpoint, {
        ...request,
        pdfBase64: bytesToBase64(request.bytes),
        bytes: undefined,
      });
      if (!response.ok) {
        continue;
      }
      const result: unknown = await response.json();
      if (isEngineApplyResponse(result)) {
        return base64ToBytes(result.pdfBase64);
      }
    } catch (error) {
      console.warn(`PDF engine certificate signing failed at ${endpoint}`, error);
    }
  }
  return null;
}

export async function validateSignatureWithEngine(bytes: Uint8Array): Promise<SignatureValidation | null> {
  const endpoints = buildEngineEndpoints("/api/pdf/signature-validate");
  for (const endpoint of endpoints) {
    try {
      const response = await postPdfBytes(endpoint, bytes);
      if (!response.ok) {
        continue;
      }
      const result: unknown = await response.json();
      if (isSignatureValidation(result)) {
        return result;
      }
    } catch (error) {
      console.warn(`PDF engine signature validation failed at ${endpoint}`, error);
    }
  }
  return null;
}

export async function comparePdfWithEngine(
  leftBytes: Uint8Array,
  rightBytes: Uint8Array,
  report = true,
): Promise<CompareResult | null> {
  const endpoints = buildEngineEndpoints("/api/pdf/compare");
  for (const endpoint of endpoints) {
    try {
      const response = await postJson(endpoint, {
        leftBase64: bytesToBase64(leftBytes),
        rightBase64: bytesToBase64(rightBytes),
        report,
      });
      if (!response.ok) {
        continue;
      }
      const result: unknown = await response.json();
      if (isCompareResult(result)) {
        return result;
      }
    } catch (error) {
      console.warn(`PDF engine compare failed at ${endpoint}`, error);
    }
  }
  return null;
}

export async function batchPdfWithEngine(jobs: BatchJobRequest[]): Promise<BatchResult | null> {
  const endpoints = buildEngineEndpoints("/api/pdf/batch");
  for (const endpoint of endpoints) {
    try {
      const response = await postJson(endpoint, {
        jobs: jobs.map((job) => ({
          fileName: job.fileName,
          pdfBase64: bytesToBase64(job.bytes),
          payload: job.payload,
        })),
      });
      if (!response.ok) {
        continue;
      }
      const result: unknown = await response.json();
      if (isBatchResult(result)) {
        return result;
      }
    } catch (error) {
      console.warn(`PDF engine batch failed at ${endpoint}`, error);
    }
  }
  return null;
}

export async function validatePdfWithEngine(bytes: Uint8Array): Promise<ExportValidation | null> {
  const endpoints = buildEngineEndpoints("/api/pdf/validate");
  for (const endpoint of endpoints) {
    try {
      const response = await postPdfBytes(endpoint, bytes);
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

function postPdfBytes(endpoint: string, bytes: Uint8Array): Promise<Response> {
  return postJson(endpoint, { pdfBase64: bytesToBase64(bytes) });
}

function postJson(endpoint: string, body: unknown): Promise<Response> {
  return fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function isEngineApplyResponse(value: unknown): value is EngineApplyResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).pdfBase64 === "string"
  );
}

function isPreflightFixupResponse(value: unknown): value is PreflightFixupResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.ok === "boolean" &&
    typeof candidate.pdfBase64 === "string" &&
    typeof candidate.report === "object" &&
    candidate.report !== null
  );
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

function isOcrStatus(value: unknown): value is OcrStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.ok === "boolean" &&
    Array.isArray(candidate.requestedLanguages) &&
    Array.isArray(candidate.availableLanguages)
  );
}

function isSignatureValidation(value: unknown): value is SignatureValidation {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.ok === "boolean" &&
    typeof candidate.signatureCount === "number" &&
    Array.isArray(candidate.signatures)
  );
}

function isCompareResult(value: unknown): value is CompareResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.ok === "boolean" &&
    Array.isArray(candidate.changedPages) &&
    Array.isArray(candidate.textChanges) &&
    Array.isArray(candidate.renderChanges)
  );
}

function isBatchResult(value: unknown): value is BatchResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.ok === "boolean" &&
    typeof candidate.jobCount === "number" &&
    typeof candidate.successCount === "number" &&
    typeof candidate.failureCount === "number" &&
    Array.isArray(candidate.jobs)
  );
}
