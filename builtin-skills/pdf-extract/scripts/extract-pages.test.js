const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const extractScript = path.join(__dirname, "extract.mjs");

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function createFakeInstallRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oneclaw-pdf-extract-test-"));
  const openclawRoot = path.join(root, "gateway", "node_modules", "openclaw");
  writeFile(path.join(openclawRoot, "package.json"), JSON.stringify({ name: "openclaw", version: "0.0.0" }));

  writeFile(
    path.join(openclawRoot, "node_modules", "pdfjs-dist", "package.json"),
    JSON.stringify({ name: "pdfjs-dist", version: "0.0.0", type: "module" })
  );
  writeFile(
    path.join(openclawRoot, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs"),
    [
      "export function getDocument() {",
      "  return { promise: Promise.resolve({",
      "    numPages: 2,",
      "    async getPage(pageNum) {",
      "      return {",
      "        async getTextContent() { return { items: [{ str: `page ${pageNum} `.repeat(80) }] }; },",
      "        getViewport() { return { width: 10, height: 10 }; },",
      "        render() { return { promise: Promise.resolve() }; }",
      "      };",
      "    }",
      "  }) };",
      "}",
      "",
    ].join("\n")
  );

  writeFile(
    path.join(openclawRoot, "node_modules", "@napi-rs", "canvas", "package.json"),
    JSON.stringify({ name: "@napi-rs/canvas", version: "0.0.0", type: "module", main: "index.mjs" })
  );
  writeFile(
    path.join(openclawRoot, "node_modules", "@napi-rs", "canvas", "index.mjs"),
    "export function createCanvas() { return { toBuffer() { return Buffer.from('png'); } }; }\n"
  );

  const pdfPath = path.join(root, "two-pages.pdf");
  writeFile(pdfPath, "%PDF-1.4\n% fake fixture; parser is mocked by fake pdfjs\n");
  return { root, pdfPath };
}

function runExtract(installRoot, pdfPath, pages) {
  return spawnSync(process.execPath, [extractScript, pdfPath, "--pages", pages], {
    encoding: "utf8",
    env: { ...process.env, OPENCLAW_INSTALL_ROOT: installRoot },
  });
}

test("all requested pages outside the document fail with page count", () => {
  const { root, pdfPath } = createFakeInstallRoot();
  try {
    const result = runExtract(root, pdfPath, "999");

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^pdf-extract: no requested pages within document \(pageCount=2\)\n$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("mixed valid and out-of-range pages still extract valid pages", () => {
  const { root, pdfPath } = createFakeInstallRoot();
  try {
    const result = runExtract(root, pdfPath, "2,999");

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.fallbackImages, false);
    assert.deepEqual(output.extractedPages, [2]);
    assert.equal(output.pageCount, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
