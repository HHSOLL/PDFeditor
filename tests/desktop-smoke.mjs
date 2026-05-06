import path from "node:path";
import { validateDesktopReadiness } from "./desktop-readiness-check.mjs";

const root = process.cwd();
const releaseRoot = path.join(root, "release", "pdfeditor-local");

await validateDesktopReadiness(releaseRoot);
