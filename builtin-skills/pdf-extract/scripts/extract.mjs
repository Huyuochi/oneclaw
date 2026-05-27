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
import { createHash, randomUUID } from "node:crypto";
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
  return ["gateway.asar", "gateway"].map((gatewayRoot) =>
    path.join(installRoot, gatewayRoot, "node_modules", "openclaw", "package.json"));
}

function asarRuntimeHint() {
  const installRoot = process.env.OPENCLAW_INSTALL_ROOT;
  if (!installRoot) return "";
  const asarPath = path.join(installRoot, "gateway.asar");
  const asarPackageJson = path.join(asarPath, "node_modules", "openclaw", "package.json");
  if (!existsSync(asarPath) || existsSync(asarPackageJson)) return "";

  const runtimeCandidates = ["runtime/node", "runtime/node.cmd", "runtime/node.exe"]
    .map((rel) => path.join(installRoot, rel))
    .filter((candidate) => existsSync(candidate));
  const runtime = runtimeCandidates[0] || path.join(installRoot, "runtime", "node");
  return `; gateway.asar exists at ${asarPath} but is not readable by this Node runtime. ` +
    `Run with OneClaw's ASAR-capable runtime (${runtime}) or provide a loose gateway/ target`;
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
      ? `also tried OPENCLAW_INSTALL_ROOT=${process.env.OPENCLAW_INSTALL_ROOT}${asarRuntimeHint()}`
      : "OPENCLAW_INSTALL_ROOT is not set";
    throw new Error(`${directErr.message}; ${hint}`);
  }
}

function readFlagValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) fail(`missing value for ${flag}`);
  return value;
}

function parseArgs(argv) {
  const args = { pdfPath: null, pages: null, outDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pages") {
      args.pages = readFlagValue(argv, i, "--pages");
      i++;
    } else if (a === "--out-dir") {
      args.outDir = readFlagValue(argv, i, "--out-dir");
      i++;
    } else if (a.startsWith("--")) fail(`unknown flag: ${a}`);
    else if (!args.pdfPath) args.pdfPath = a;
    else fail(`unexpected positional arg: ${a}`);
  }
  if (!args.pdfPath) fail("usage: extract.mjs <pdf-path> [--pages 1,2,3] [--out-dir <dir>]");
  return args;
}

function parsePages(spec) {
  if (spec === null) return null;
  const normalized = String(spec).trim();
  if (!/^[1-9]\d*(\s*,\s*[1-9]\d*)*$/.test(normalized)) {
    fail(`invalid --pages: ${spec}`);
  }
  return normalized.split(",").map((part) => {
    const n = Number(part.trim());
    if (!Number.isSafeInteger(n)) fail(`invalid --pages: ${spec}`);
    return n;
  });
}

function installQuietOutput() {
  const methods = ["debug", "error", "info", "log", "warn"];
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const noopWrite = function (_chunk, encodingOrCallback, callback) {
    if (typeof encodingOrCallback === "function") encodingOrCallback();
    if (typeof callback === "function") callback();
    return true;
  };

  for (const method of methods) {
    console[method] = () => {};
  }
  process.stdout.write = noopWrite;
  process.stderr.write = noopWrite;
  process.emitWarning = () => {};

  return {
    writeStdout(chunk) {
      return originalStdoutWrite.call(process.stdout, chunk);
    },
    writeStderr(chunk) {
      return originalStderrWrite.call(process.stderr, chunk);
    },
  };
}

function uniqueOutputDir(pdfPath, outDir) {
  const pdfHash = createHash("sha1").update(pdfPath).digest("hex").slice(0, 12);
  const runId = `oneclaw-pdf-${pdfHash}-${process.pid}-${randomUUID().slice(0, 8)}`;
  return outDir ? path.join(path.resolve(outDir), runId) : path.join(tmpdir(), runId);
}

function fitCanvasToPixelBudget(page, viewport, maxPixels) {
  const budget = Math.max(1, maxPixels);
  const baseWidth = Math.max(1, Number(viewport.width) || 1);
  const baseHeight = Math.max(1, Number(viewport.height) || 1);
  const basePixels = baseWidth * baseHeight;
  const initialScale = Math.min(1, Math.sqrt(budget / Math.max(1, basePixels)));
  let width = Math.max(1, Math.floor(baseWidth * initialScale));
  let height = Math.max(1, Math.floor(baseHeight * initialScale));

  if (width * height > budget) {
    if (width >= height) {
      width = Math.max(1, Math.floor(budget / height));
    } else {
      height = Math.max(1, Math.floor(budget / width));
    }
  }

  while (width * height > budget) {
    if (width >= height && width > 1) width--;
    else if (height > 1) height--;
    else break;
  }

  const fittedScale = Math.min(width / baseWidth, height / baseHeight);
  return {
    viewport: page.getViewport({ scale: fittedScale }),
    width,
    height,
  };
}

async function extractPdf(args, pdfPath, buffer, pageNumbers) {
  let getDocument;
  try {
    ({ getDocument } = await importGatewayDependency("pdfjs-dist/legacy/build/pdf.mjs"));
  } catch (err) {
    throw new Error(`pdfjs-dist not available: ${err.message}`);
  }

  // verbosity: 0 (ERRORS) silences pdfjs warnings on stderr (e.g. "Indexing
  // all PDF objects", "standardFontDataUrl not configured"). installQuietOutput
  // also suppresses pdfjs paths that still write directly to stdio.
  const pdf = await getDocument({ data: new Uint8Array(buffer), disableWorker: true, verbosity: 0 }).promise;
  const pageCount = pdf.numPages;
  const effectivePages = pageNumbers
    ? pageNumbers.filter((p) => p >= 1 && p <= pageCount)
    : Array.from({ length: pageCount }, (_, i) => i + 1);
  if (pageNumbers && effectivePages.length === 0) {
    throw new Error(`no requested pages within document (pageCount=${pageCount})`);
  }

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
    return {
      text, fallbackImages: false, imagePaths: [],
      pageCount, extractedPages: effectivePages, truncatedText,
    };
  }

  let createCanvas;
  try {
    ({ createCanvas } = await importGatewayDependency("@napi-rs/canvas"));
  } catch (err) {
    throw new Error(`@napi-rs/canvas not available for scanned-PDF fallback: ${err.message}`);
  }

  const outDir = uniqueOutputDir(pdfPath, args.outDir);
  await mkdir(outDir, { recursive: true });

  const imagePaths = [];
  for (const pageNum of effectivePages) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const fitted = fitCanvasToPixelBudget(page, viewport, DEFAULTS.maxPixels);
    const canvas = createCanvas(fitted.width, fitted.height);
    await page.render({ canvas, viewport: fitted.viewport }).promise;
    const png = canvas.toBuffer("image/png");
    const out = path.join(outDir, `page-${pageNum}.png`);
    await writeFile(out, png);
    imagePaths.push(out);
  }

  return {
    text, fallbackImages: true, imagePaths,
    pageCount, extractedPages: effectivePages, truncatedText,
  };
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
  const quiet = installQuietOutput();
  try {
    const output = await extractPdf(args, pdfPath, buffer, pageNumbers);
    quiet.writeStdout(JSON.stringify(output) + "\n");
  } catch (err) {
    quiet.writeStderr(`pdf-extract: ${err?.message || String(err)}\n`);
    process.exit(1);
  }
}

main().catch((err) => fail(err?.message || String(err)));
