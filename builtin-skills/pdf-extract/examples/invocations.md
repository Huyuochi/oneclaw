# Invocations

Worked examples. All paths must be absolute.

## Plain text PDF

```
export OPENCLAW_INSTALL_ROOT=/Applications/OneClaw.app/Contents/Resources/resources
"$OPENCLAW_INSTALL_ROOT/runtime/node" \
  /Users/alice/.openclaw/workspace/skills/pdf-extract/scripts/extract.mjs \
  /Users/alice/Downloads/report.pdf
```

Output (single line, formatted here for readability):

```json
{
  "text": "OneClaw Quarterly Report\nQ1 2026 — Engineering ...",
  "fallbackImages": false,
  "imagePaths": [],
  "pageCount": 12,
  "extractedPages": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  "truncatedText": false
}
```

## Restrict to specific pages

```
"$OPENCLAW_INSTALL_ROOT/runtime/node" .../extract.mjs /path/to/spec.pdf --pages 1,3,5
```

`--pages` is 1-based, comma-separated. Pages outside the document are
dropped only when at least one requested page is in range. If every requested
page is outside the document, extraction fails with the PDF page count. Every
valid caller-specified page is extracted; there is no silent page-count cap.
Ranges (`1-3`), decimals (`1.5`), partial numbers (`3abc`), blank values, and
missing values are rejected.

## Scanned / image-only PDF

```
"$OPENCLAW_INSTALL_ROOT/runtime/node" .../extract.mjs /path/to/scanned-invoice.pdf
```

Because page text falls below 200 chars, the script renders each page to a
PNG and returns the file paths:

```json
{
  "text": "",
  "fallbackImages": true,
  "imagePaths": [
    "/var/folders/x/.../oneclaw-pdf-abc123-12345-deadbeef/page-1.png",
    "/var/folders/x/.../oneclaw-pdf-abc123-12345-deadbeef/page-2.png"
  ],
  "pageCount": 2,
  "extractedPages": [1, 2],
  "truncatedText": false
}
```

Pass these paths to whatever image-reading tool the model has (typically
the built-in image read on the model's API surface).

## Custom output directory for PNGs

```
"$OPENCLAW_INSTALL_ROOT/runtime/node" .../extract.mjs /path/to/scanned.pdf --out-dir /tmp/my-pdf-pages
```

Useful when you want the renders to survive past the current shell session
or when `$TMPDIR` is restricted. The directory is created if it doesn't
exist. Each run creates a unique child directory under `/tmp/my-pdf-pages`, so
concurrent runs do not overwrite each other's `page-N.png` files.

## Errors

```
$ "$OPENCLAW_INSTALL_ROOT/runtime/node" .../extract.mjs /tmp/missing.pdf
pdf-extract: file not found: /tmp/missing.pdf
# exit code: 1
```

```
$ "$OPENCLAW_INSTALL_ROOT/runtime/node" .../extract.mjs /tmp/huge.pdf
pdf-extract: file too large: 73400320 bytes (limit 52428800)
# exit code: 1
```

```
$ "$OPENCLAW_INSTALL_ROOT/runtime/node" .../extract.mjs /tmp/two-pages.pdf --pages 999
pdf-extract: no requested pages within document (pageCount=2)
# exit code: 1
```

PDFs up to 50 MiB pass the size gate. For large PDFs, the user/caller owns
the output quality, runtime, fallback-image volume, and context-window risk.
