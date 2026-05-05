import { enginePath, runProcess } from "./helpers/pdf-engine-test-utils.mjs";

const { stdout } = await runProcess("python3", [
  enginePath,
  "ocr-status",
  "--language",
  "eng+kor",
  "--stdout",
]);
const status = JSON.parse(stdout);

if (!status.ok) {
  throw new Error(`OCR runtime is not ready: ${JSON.stringify(status)}`);
}

console.log(`OCR ready: ${status.version} (${status.tessdata})`);
