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
  return `
    <div class="preflight-panel">
      <strong>사전 검사: ${summary.status}</strong>
      <span>${report.pageCount}쪽 · ${report.fontCount}개 폰트 · ${report.formFieldCount}개 폼 필드 · ${warningText}</span>
      ${findings}
      ${report.warnings.length ? `<small>${escapeHtml(report.warnings.slice(0, 3).join(" · "))}</small>` : ""}
    </div>
  `;
}
