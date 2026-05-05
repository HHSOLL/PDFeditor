import { summarizePreflightReport } from "./preflightReport";
import type { PreflightReport } from "./types";

export function renderPreflightPanel(
  report: PreflightReport,
  escapeHtml: (value: string) => string,
): string {
  const warningText = report.warnings.length ? `${report.warnings.length}개 경고` : "경고 없음";
  const summary = summarizePreflightReport(report);
  const findings = summary.findings.length
    ? `<small>${escapeHtml(summary.findings.slice(0, 5).join(" · "))}</small>`
    : "";
  const standards = report.standardsValidation;
  const standardsLine = standards
    ? `<small>표준 검증: ${
        standards.available
          ? `${escapeHtml(standards.validator)} ${escapeHtml(standards.validatorVersion || "")} · ${escapeHtml(standards.profileName || "auto")} · ${
              standards.passed ? "통과" : `실패 ${standards.failedChecks} checks`
            }`
          : "veraPDF 없음"
      }</small>`
    : "";
  return `
    <div class="preflight-panel">
      <strong>사전 검사: ${summary.status}</strong>
      <span>${report.pageCount}쪽 · ${report.fontCount}개 폰트 · ${report.formFieldCount}개 폼 필드 · ${warningText}</span>
      ${findings}
      ${standardsLine}
      ${report.warnings.length ? `<small>${escapeHtml(report.warnings.slice(0, 3).join(" · "))}</small>` : ""}
    </div>
  `;
}
