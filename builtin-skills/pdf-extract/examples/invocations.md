# Invocations

Worked examples. All paths must be absolute.

## Plain text PDF

```
node /Users/alice/.openclaw/workspace/skills/pdf-extract/scripts/extract.mjs \
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
node .../extract.mjs /path/to/spec.pdf --pages 1,3,5
```

`--pages` is 1-based, comma-separated. Pages outside the document are
silently dropped. Every valid caller-specified page is extracted; there is no
silent page-count cap.

## Scanned / image-only PDF

```
node .../extract.mjs /path/to/scanned-invoice.pdf
```

Because page text falls below 200 chars, the script renders each page to a
PNG and returns the file paths:

```json
{
  "text": "",
  "fallbackImages": true,
  "imagePaths": [
    "/var/folders/x/.../oneclaw-pdf-abc123/page-1.png",
    "/var/folders/x/.../oneclaw-pdf-abc123/page-2.png"
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
node .../extract.mjs /path/to/scanned.pdf --out-dir /tmp/my-pdf-pages
```

Useful when you want the renders to survive past the current shell session
or when `$TMPDIR` is restricted. The directory is created if it doesn't
exist; existing files with the same name (`page-N.png`) are overwritten.

## Errors

```
$ node .../extract.mjs /tmp/missing.pdf
pdf-extract: file not found: /tmp/missing.pdf
# exit code: 1
```

```
$ node .../extract.mjs /tmp/huge.pdf
pdf-extract: file too large: 73400320 bytes (limit 52428800)
# exit code: 1
```

PDFs up to 50 MiB pass the size gate. For large PDFs, the user/caller owns
the output quality, runtime, fallback-image volume, and context-window risk.
