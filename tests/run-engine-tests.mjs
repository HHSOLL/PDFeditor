import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess } from "./helpers/pdf-engine-test-utils.mjs";

const root = process.cwd();
const testsDir = path.dirname(fileURLToPath(import.meta.url));
const entries = await fs.readdir(testsDir);
const testFiles = entries
  .filter((entry) => /^engine-.*\.mjs$/.test(entry))
  .sort();

for (const file of testFiles) {
  process.stdout.write(`\n[engine] ${file}\n`);
  await runProcess(process.execPath, [path.join(testsDir, file)], { cwd: root });
}
