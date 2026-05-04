import type { DocumentMetadata } from "./types";

export function emptyMetadata(): DocumentMetadata {
  return {
    title: "",
    author: "",
    subject: "",
    keywords: "",
    creator: "PDF Studio",
    producer: "PDF Studio Engine",
  };
}

export function asMetadataString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
