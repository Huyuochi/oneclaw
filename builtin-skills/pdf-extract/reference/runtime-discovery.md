# Runtime discovery

This skill ships as a small wrapper around the PDF dependencies bundled with
OpenClaw. The wrapper is stable for the current branch:

```
export OPENCLAW_INSTALL_ROOT=<oneclaw-resource-root>
"$OPENCLAW_INSTALL_ROOT/runtime/node" <skill-dir>/scripts/extract.mjs <absolute-pdf-path> [--pages 1,3,5] [--out-dir <absolute-dir>]
```

`<skill-dir>` is the directory that contains `SKILL.md`. On Windows, use
`%OPENCLAW_INSTALL_ROOT%\runtime\node.cmd` instead of `runtime/node`.

## Dependency lookup

The wrapper first tries normal Node module lookup from its own location. That
works when the skill runs from inside a gateway dependency tree that already
contains `pdfjs-dist` and `@napi-rs/canvas`.

If direct lookup fails, set `OPENCLAW_INSTALL_ROOT` to the generated or packaged
target root. The wrapper then checks these OpenClaw package candidates:

| Layout | Candidate package |
|---|---|
| Gateway ASAR | `$OPENCLAW_INSTALL_ROOT/gateway.asar/node_modules/openclaw/package.json` |
| Unpacked gateway | `$OPENCLAW_INSTALL_ROOT/gateway/node_modules/openclaw/package.json` |

From each candidate, the wrapper resolves gateway dependencies with Node's
package resolver. `pdfjs-dist` is required for every run. `@napi-rs/canvas` is
only required when text extraction falls back to rendered PNG pages for a
scanned or image-only PDF.

The ASAR candidate is preferred to match packaged OneClaw runtime behavior. If
`gateway.asar` is a real archive file, ordinary system Node treats it as a file
and cannot read paths such as `gateway.asar/node_modules/...`; run the command
with the bundled OneClaw runtime under `$OPENCLAW_INSTALL_ROOT/runtime/`.

## Source checkout

In this repository, a checkout does not install `pdfjs-dist` at the root. Use a
generated target root when running the skill directly:

```
export OPENCLAW_INSTALL_ROOT=/Users/moonshot/codes/oneclaw-pdf-skill/resources/targets/darwin-arm64
"$OPENCLAW_INSTALL_ROOT/runtime/node" builtin-skills/pdf-extract/scripts/extract.mjs /absolute/path/to/file.pdf
```

Adjust `darwin-arm64` to the target that exists under `resources/targets/`.
For a loose `gateway/` target, system Node also works if `OPENCLAW_INSTALL_ROOT`
is set. For an ASAR-only target, use the bundled runtime.

## Copied workspace skill

When the skill has been copied to a workspace such as
`~/.openclaw/workspace/skills/pdf-extract`, it may no longer sit next to gateway
dependencies. In that case, set `OPENCLAW_INSTALL_ROOT` to the OneClaw packaged
resource root or another explicit target root that contains the gateway
dependency tree.

## Packaged resources and ASAR

Packaged apps may provide dependencies as loose files under `gateway/` or inside
`gateway.asar`. The wrapper checks both layouts and prefers `gateway.asar`.
Native dependencies used by the scanned-PDF fallback can still depend on files
unpacked beside the ASAR; if text extraction succeeds, those native bindings are
not loaded.

## Failure diagnosis

| Symptom | Meaning | Action |
|---|---|---|
| `pdfjs-dist not available` and `OPENCLAW_INSTALL_ROOT is not set` | Dependency discovery failed before parsing the PDF. | Set `OPENCLAW_INSTALL_ROOT` or run from a gateway dependency tree. |
| `pdfjs-dist not available` and an `OPENCLAW_INSTALL_ROOT=...` hint | The provided root does not contain a resolvable OpenClaw gateway package. | Check the target path and whether resources were generated. |
| `gateway.asar exists ... not readable by this Node runtime` | The target is ASAR-only, but the current process is ordinary Node without ASAR path support. | Re-run with `$OPENCLAW_INSTALL_ROOT/runtime/node` or `%OPENCLAW_INSTALL_ROOT%\runtime\node.cmd`. |
| `@napi-rs/canvas not available for scanned-PDF fallback` | Text extraction found too little text and the image renderer could not load. | Treat the PDF as likely scanned/image-only and fix the native dependency path. |

Do not report dependency discovery failures as PDF parsing failures.

## Page selection policy

There is no page-count cap. When `--pages` is omitted, the wrapper attempts to
parse every page in the PDF. When `--pages` is present, the wrapper attempts
every valid 1-based page number provided by the caller and drops pages outside
the document only when at least one requested page is in range. If every
requested page is outside the document, the wrapper fails with the source
`pageCount`.

`--pages` only accepts comma-separated positive integers such as `1,3,5`.
Missing values, blank values, ranges such as `1-3`, decimals such as `1.5`,
and partial numbers such as `3abc` are hard errors.

The caller owns the risk of broad extraction: large PDFs can fail, run for a
long time, render many fallback PNGs, or fill a large amount of model context.
If the caller wants a narrower read, they must pass a narrower `--pages` list.
