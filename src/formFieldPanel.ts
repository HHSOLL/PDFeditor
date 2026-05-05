import type { FormFieldAnnotation } from "./types";

export function renderFormFieldInspector(
  annotation: FormFieldAnnotation,
  escapeHtml: (value: string) => string,
): string {
  const isSourceField = Boolean(annotation.sourceAnnotationId);
  const valueControl = annotation.fieldType === "signature"
    ? `<input id="formValue" type="text" value="${escapeHtml(annotation.unsupportedReason ?? "서명 필드")}" disabled />`
    : annotation.fieldType === "checkbox" || annotation.fieldType === "radio"
      ? `
        <label class="checkbox-line">
          <input id="formChecked" type="checkbox"${annotation.checked ? " checked" : ""} />
          선택됨
        </label>
      `
      : annotation.fieldType === "combo" || annotation.fieldType === "list"
        ? `
          <select id="formValue"${annotation.fieldType === "list" ? " size=\"4\"" : ""}>
            ${renderFormFieldOptions(annotation, escapeHtml)}
          </select>
        `
      : `<input id="formValue" type="text" value="${escapeHtml(annotation.fieldValue)}" />`;
  return `
    <div class="field">
      <label>폼 필드</label>
      <input id="formName" type="text" value="${escapeHtml(annotation.fieldName)}"${isSourceField ? " disabled" : ""} />
    </div>
    <div class="field">
      <label>필드 유형</label>
      <select id="formType"${isSourceField ? " disabled" : ""}>
        ${renderFormFieldTypeOptions(annotation.fieldType)}
      </select>
    </div>
    <div class="field">
      <label>값</label>
      ${valueControl}
    </div>
    <div class="field two-col">
      <label class="checkbox-line">
        <input id="formRequired" type="checkbox"${annotation.required ? " checked" : ""}${annotation.fieldType === "signature" ? " disabled" : ""} />
        필수
      </label>
      <label class="checkbox-line">
        <input id="formReadOnly" type="checkbox"${annotation.readOnly ? " checked" : ""} disabled />
        읽기 전용
      </label>
    </div>
    <div class="field">
      <label>기본값</label>
      <input id="formDefaultValue" type="text" value="${escapeHtml(annotation.defaultValue ?? "")}"${annotation.fieldType === "signature" ? " disabled" : ""} />
    </div>
    <div class="field">
      <label>탭 순서</label>
      <input id="formTabIndex" type="number" min="1" step="1" value="${annotation.tabIndex ?? ""}"${annotation.fieldType === "signature" ? " disabled" : ""} />
    </div>
    ${
      annotation.fieldType === "combo" || annotation.fieldType === "list"
        ? `
          <div class="field">
            <label>선택 항목</label>
            <textarea id="formOptions" rows="4">${escapeHtml((annotation.options ?? []).join("\n"))}</textarea>
          </div>
        `
        : ""
    }
  `;
}

function renderFormFieldTypeOptions(selected: FormFieldAnnotation["fieldType"]): string {
  return [
    ["text", "텍스트"],
    ["checkbox", "체크박스"],
    ["radio", "라디오"],
    ["combo", "드롭다운"],
    ["list", "리스트"],
  ]
    .map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`)
    .join("");
}

export function renderFormFieldOptions(
  annotation: FormFieldAnnotation,
  escapeHtml: (value: string) => string,
): string {
  const options = annotation.options?.length ? annotation.options : [annotation.fieldValue].filter(Boolean);
  return options
    .map((option) => `<option value="${escapeHtml(option)}"${option === annotation.fieldValue ? " selected" : ""}>${escapeHtml(option)}</option>`)
    .join("");
}
