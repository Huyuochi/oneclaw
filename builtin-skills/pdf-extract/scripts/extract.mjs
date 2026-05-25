#!/usr/bin/env node
// PDF extraction script for the pdf-extract built-in skill.
//
// Algorithm ported from openclaw's internal pdf-extract module
// (gateway: dist/pdf-extract-Obqsm9U3.js + dist/input-files-0oShoO1j.js).
// Intentional divergences: verbosity: 0 for empty-stderr success output, and
// 50 MiB / no page-count caps because callers own broad-extraction risk.
// Two-stage: try text via pdfjs getTextContent; if it falls below
// minTextChars, render each page to PNG via @napi-rs/canvas.
//
// Dependencies resolve via normal Node lookup when bundled inside gateway,
// or via OPENCLAW_INSTALL_ROOT when copied to the user workspace.

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const DEFAULTS = {
  maxBytes: 52_428_800,  // 50 MiB
  maxPixels: 4_000_000,
  minTextChars: 200,
  maxChars: 200_000,
};

function fail(msg, code = 1) {
  process.stderr.write(`pdf-extract: ${msg}\n`);
  process.exit(code);
}

function bundledOpenclawPackageJsons() {
  const installRoot = process.env.OPENCLAW_INSTALL_ROOT;
  if (!installRoot) return [];
  return ["gateway", "gateway.asar"].map((gatewayRoot) =>
    path.join(installRoot, gatewayRoot, "node_modules", "openclaw", "package.json"));
}

async function importGatewayDependency(specifier) {
  try {
    return await import(specifier);
  } catch (directErr) {
    for (const packageJson of bundledOpenclawPackageJsons()) {
      if (!existsSync(packageJson)) continue;
      try {
        const resolved = createRequire(packageJson).resolve(specifier);
        return await import(pathToFileURL(resolved).href);
      } catch {}
    }
    const hint = process.env.OPENCLAW_INSTALL_ROOT
      ? `also tried OPENCLAW_INSTALL_ROOT=${process.env.OPENCLAW_INSTALL_ROOT}`
      : "OPENCLAW_INSTALL_ROOT is not set";
    throw new Error(`${directErr.message}; ${hint}`);
  }
}

function parseArgs(argv) {
  const args = { pdfPath: null, pages: null, outDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pages") args.pages = argv[++i];
    else if (a === "--out-dir") args.outDir = argv[++i];
    else if (a.startsWith("--")) fail(`unknown flag: ${a}`);
    else if (!args.pdfPath) args.pdfPath = a;
    else fail(`unexpected positional arg: ${a}`);
  }
  if (!args.pdfPath) fail("usage: extract.mjs <pdf-path> [--pages 1,2,3] [--out-dir <dir>]");
  return args;
}

function parsePages(spec) {
  if (!spec) return null;
  const out = [];
  for (const part of spec.split(",")) {
    const n = Number.parseInt(part.trim(), 10);
    if (!Number.isFinite(n) || n < 1) fail(`invalid page number: ${part}`);
    out.push(n);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pdfPath = path.resolve(args.pdfPath);
  if (!existsSync(pdfPath)) fail(`file not found: ${pdfPath}`);
  const stat = statSync(pdfPath);
  if (stat.size > DEFAULTS.maxBytes) {
    fail(`file too large: ${stat.size} bytes (limit ${DEFAULTS.maxBytes})`);
  }

  const buffer = await readFile(pdfPath);
  const pageNumbers = parsePages(args.pages);

  let getDocument;
  try {
    ({ getDocument } = await importGatewayDependency("pdfjs-dist/legacy/build/pdf.mjs"));
  } catch (err) {
    fail(`pdfjs-dist not available: ${err.message}`);
  }

  // verbosity: 0 (ERRORS) silences pdfjs warnings on stderr (e.g. "Indexing
  // all PDF objects", "standardFontDataUrl not configured"). The output-format
  // contract reserves stderr for hard errors only.
  const pdf = await getDocument({ data: new Uint8Array(buffer), disableWorker: true, verbosity: 0 }).promise;
  const pageCount = pdf.numPages;
  const effectivePages = pageNumbers
    ? pageNumbers.filter((p) => p >= 1 && p <= pageCount)
    : Array.from({ length: pageCount }, (_, i) => i + 1);

  const textParts = [];
  for (const pageNum of effectivePages) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? String(item.str) : ""))
      .filter(Boolean)
      .join(" ");
    if (pageText) textParts.push(pageText);
  }
  let text = textParts.join("\n\n");
  let truncatedText = false;
  if (text.length > DEFAULTS.maxChars) {
    text = text.slice(0, DEFAULTS.maxChars);
    truncatedText = true;
  }

  if (text.trim().length >= DEFAULTS.minTextChars) {
    process.stdout.write(JSON.stringify({
      text, fallbackImages: false, imagePaths: [],
      pageCount, extractedPages: effectivePages, truncatedText,
    }) + "\n");
    return;
  }

  let createCanvas;
  try {
    ({ createCanvas } = await importGatewayDependency("@napi-rs/canvas"));
  } catch (err) {
    fail(`@napi-rs/canvas not available for scanned-PDF fallback: ${err.message}`);
  }

  const outDir = args.outDir
    ? path.resolve(args.outDir)
    : path.join(tmpdir(), `oneclaw-pdf-${createHash("sha1").update(pdfPath).digest("hex").slice(0, 12)}`);
  await mkdir(outDir, { recursive: true });

  const imagePaths = [];
  const pixelBudget = Math.max(1, DEFAULTS.maxPixels);
  for (const pageNum of effectivePages) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const pagePixels = viewport.width * viewport.height;
    const scale = Math.min(1, Math.sqrt(pixelBudget / Math.max(1, pagePixels)));
    const scaled = page.getViewport({ scale: Math.max(0.1, scale) });
    const canvas = createCanvas(Math.ceil(scaled.width), Math.ceil(scaled.height));
    await page.render({ canvas, viewport: scaled }).promise;
    const png = canvas.toBuffer("image/png");
    const out = path.join(outDir, `page-${pageNum}.png`);
    await writeFile(out, png);
    imagePaths.push(out);
  }

  process.stdout.write(JSON.stringify({
    text, fallbackImages: true, imagePaths,
    pageCount, extractedPages: effectivePages, truncatedText,
  }) + "\n");
}

main().catch((err) => fail(err?.stack || String(err)));
