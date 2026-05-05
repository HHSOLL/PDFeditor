import fs from "node:fs/promises";
import path from "node:path";
import {
  enginePath,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-preflight-standards-signals");
const inputPath = path.join(workDir, "standards-source.pdf");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createStandardsFixture(inputPath);

const validation = await validatePdf(inputPath);
if (!validation.ok || !validation.qpdfChecked) {
  throw new Error(`standards preflight fixture failed validation: ${JSON.stringify(validation)}`);
}

const report = await preflight(inputPath);
if (report.pdfaClaim !== "PDF/A-2U") {
  throw new Error(`PDF/A XMP claim was not detected: ${JSON.stringify(report)}`);
}
if (!report.warnings.includes("PDF/A claim is present without an OutputIntent signal")) {
  throw new Error(`PDF/A missing OutputIntent warning was not emitted: ${JSON.stringify(report.warnings)}`);
}

async function createStandardsFixture(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "xmp = '''<?xpacket begin=\"\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>",
      "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\">",
      "<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">",
      "<rdf:Description xmlns:pdfaid=\"http://www.aiim.org/pdfa/ns/id/\" rdf:about=\"\">",
      "<pdfaid:part>2</pdfaid:part><pdfaid:conformance>u</pdfaid:conformance>",
      "</rdf:Description></rdf:RDF></x:xmpmeta>",
      "<?xpacket end=\"w\"?>'''",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 96), 'PDF/A claim signal fixture', fontsize=18)",
      "doc.set_xml_metadata(xmp)",
      "doc.save(sys.argv[1], garbage=4, deflate=False, clean=False)",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
}

async function preflight(filePath) {
  const { stdout } = await runProcess("python3", [
    enginePath,
    "preflight",
    "--input",
    filePath,
    "--stdout",
  ]);
  return JSON.parse(stdout);
}
