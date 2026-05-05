import type { EnginePayload, RedactionMode, SaveMode } from "./types";

export const fullSanitizeOptions: NonNullable<EnginePayload["saveOptions"]["sanitizeOptions"]> = {
  metadata: true,
  xmlMetadata: true,
  embeddedFiles: true,
  fileAttachmentAnnotations: true,
  javascript: true,
  javascriptNameTree: true,
  annotationActions: true,
  comments: true,
  hiddenLayers: true,
  embeddedSearchIndex: true,
  staleIncrementalUpdates: true,
  unreferencedObjects: true,
  links: true,
  thumbnails: true,
  resetFormFields: false,
};

export function buildEngineSaveOptions(params: {
  saveMode: SaveMode;
  redactionMode: RedactionMode;
  sanitizeHiddenInfo: boolean;
}): EnginePayload["saveOptions"] {
  return {
    annotationMode: params.saveMode,
    redactionMode: params.redactionMode,
    flattenForms: false,
    sanitize: params.sanitizeHiddenInfo,
    sanitizeOptions: { ...fullSanitizeOptions },
    validate: true,
  };
}
