---
name: pdf-extract
description: "Use this skill when the user provides a local PDF file (path ending in .pdf, or a file with MIME application/pdf) and you need its textual content. Runs offline, no network. Outputs a single line of JSON to stdout with extracted text — or, for scanned / image-only PDFs, absolute paths to PNG renders of each page. Do NOT use this skill for: editing or generating PDFs, OCR of non-PDF images, fetching PDFs by URL, processing PDFs already attached to the chat (the gateway extracts those automatically)."
---

# pdf-extract

Extract text (and, for scanned PDFs, page renders) from a local PDF file. Single CLI, single JSON line out.

## When to use

- User points at a local `.pdf` file on disk and asks anything that requires reading its content (summarise, search, quote, translate, answer questions).
- You already have a PDF path from another tool's output (e.g. a download, a build artefact) and need its text.

## When NOT to use

- The PDF was attached to the chat as an `input_file` — the gateway already extracted it; you have the text.
- The user wants to **modify** a PDF, **create** a new PDF, sign one, or merge pages — this skill is read-only.
- The source is a URL — fetch it yourself first (within your sandbox rules), then pass the local path.
- The file is an image (`.png` / `.jpg`) that needs OCR — wrong tool.

## Quick command

```
node <skill-dir>/scripts/extract.mjs <absolute-pdf-path>
```

`<skill-dir>` is the directory containing this `SKILL.md`. Optional flags:

- `--pages 1,3,5` — extract specific pages (1-based). Default: all pages.
- `--out-dir <abs-dir>` — where to write PNGs when text extraction fails. Default: a temp dir under `$TMPDIR`.

## Output

A single line of JSON on stdout. Exit code `0` on success, `1` with an error on stderr otherwise.

```json
{
  "text": "...",
  "fallbackImages": false,
  "imagePaths": [],
  "pageCount": 12,
  "extractedPages": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  "truncatedText": false
}
```

Two cases:

1. **Text PDF** — `fallbackImages: false`, `text` is the joined page text (clamped to 200 000 chars; `truncatedText: true` if clamped). `imagePaths` is empty.
2. **Scanned / image-only PDF** — when extracted text is under 200 characters, the script renders each requested page to a PNG file and returns `fallbackImages: true` with absolute `imagePaths`. The model should read those PNGs as images.

Full schema: see `reference/output-format.md`. Worked examples: see `examples/invocations.md`. Algorithm details and defaults: see `reference/algorithm.md`. Runtime dependency discovery: see `reference/runtime-discovery.md`.

## Hard limits and budgets

| Limit          | Value         |
|----------------|---------------|
| max file size  | 50 MiB        |
| max pages      | none          |
| max text chars | 200 000       |
| min text chars | 200 (fallback threshold) |
| max pixels/page| 4 000 000 (auto-scale) |

Exceeding the 50 MiB file-size limit is a hard error. Page count is intentionally not capped: the skill parses whatever pages the caller requests, or the whole PDF when `--pages` is omitted. The caller accepts large-PDF output quality issues, failure, long runtime, many fallback PNGs, and large context usage risk for broad extraction. Text and pixel budgets remain in place to keep individual outputs bounded.

## Errors

- File missing → exit `1`, stderr `pdf-extract: file not found: <path>`.
- File over 50 MiB → exit `1`, stderr `pdf-extract: file too large: ...`.
- Native canvas binding missing (scanned-PDF fallback only) → exit `1`. Tell the user the PDF appears to be image-only and the canvas dependency is unavailable in this environment.
