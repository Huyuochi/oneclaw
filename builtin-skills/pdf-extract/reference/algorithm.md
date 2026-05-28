# Algorithm

A small wrapper around openclaw gateway's internal PDF handling (`pdf-extract`
and `input-files` modules in `node_modules/openclaw/dist/`). It keeps the same
two-stage strategy and safety budgets, but intentionally diverges from the
gateway by raising the file-size cap to 50 MiB. Explicit `--pages` requests
stay uncapped; only the implicit all-pages path has a `maxPages` sanity cap.

## Two-stage extraction

```
            ┌──────────────────────────────────────┐
            │ read file → size check (≤ maxBytes)  │
            └──────────────────┬───────────────────┘
                               ▼
            ┌──────────────────────────────────────┐
            │ pdfjs-dist getDocument()             │
            │   disableWorker: true                │
            │   pageNumbers ?? all pages           │
            └──────────────────┬───────────────────┘
                               ▼
            ┌──────────────────────────────────────┐
            │ per-page getTextContent()            │
            │   join items with " "                │
            │   join pages with "\n\n"             │
            │   clamp to maxChars                  │
            └──────────────────┬───────────────────┘
                               ▼
                  text.trim().length ≥ minTextChars ?
                       ┌───────┴───────┐
                      yes              no  (scanned / image-only)
                       │                │
                       ▼                ▼
         text-only JSON    @napi-rs/canvas createCanvas
                          ┌──────────────────────────────┐
                          │ for each page:               │
                          │   viewport @ scale=1         │
                          │   scale down so final canvas │
                          │     pixels <= maxPixels      │
                          │   render to canvas           │
                          │   toBuffer("image/png")      │
                          │   write to <runDir>/page-N.png│
                          └──────────────┬───────────────┘
                                         ▼
                              JSON with imagePaths[]
```

## Defaults and budgets

| Param         | Default     | Source / note                               |
|---------------|-------------|---------------------------------------------|
| `maxBytes`    | 52 428 800  | Skill override (`50 * 1024 * 1024`)         |
| `maxChars`    | 200 000     | `input-files-0oShoO1j.js:81` (`2e5`)        |
| `maxPages`    | 5 000       | All-pages path only; explicit `--pages` uncapped |
| `maxPixels`   | 4 000 000   | `input-files-0oShoO1j.js:86` (`4e6`)        |
| `minTextChars`| 200         | `input-files-0oShoO1j.js:87`                |

The skill intentionally diverges from the gateway file-size default. It parses
every valid caller-requested page (deduped, uncapped), or the whole PDF when no
page list is provided. The caller owns the risk of large-PDF output quality
issues, failures, long runtime, many fallback PNGs, and large context usage when
asking for broad extraction. The implicit all-pages path is the one exception:
if the document reports more than `maxPages` pages it fails fast and asks the
caller to pass an explicit `--pages` subset, so a pathological page count cannot
allocate a huge array or render thousands of PNGs.

## Why `disableWorker: true`

The gateway is itself a Node child process; pdfjs's default worker setup
expects a browser-like environment. `disableWorker: true` makes parsing
synchronous-on-the-event-loop and avoids "DOMMatrix is not defined" style
failures. This applies equally to the skill — the skill runs as a one-off
Node process and has no need (or environment) for a worker.

## Why a scale ceiling of 1 and no lower clamp

Rendering scale never exceeds `1`. A page already smaller than the budget should
not be **up**scaled — that would waste CPU without adding information. Extremely
large pages are scaled down as far as needed so the final canvas dimensions stay
within `maxPixels`; there is no lower scale clamp that can override the pixel
budget.

## Fallback image directory

When fallback rendering is needed, the script writes PNG files into a unique
per-run directory. If `--out-dir` is omitted, that directory is created under
`$TMPDIR`. If `--out-dir` is provided, the unique per-run directory is created
inside that base directory. This prevents concurrent runs for the same PDF from
overwriting each other's `page-N.png` files.

## Why no OCR

`@napi-rs/canvas` is a renderer, not an OCR engine. The fallback writes PNGs
to disk and lets the calling model do the OCR itself by reading the images.
This matches the gateway's behaviour: it sends the images to the LLM as
image content blocks and lets the model handle them.
