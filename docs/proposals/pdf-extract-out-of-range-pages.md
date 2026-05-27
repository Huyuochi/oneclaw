---
title: PDF extract rejects all-out-of-range page selections
status: accepted
date: 2026-05-28
---

# PDF extract rejects all-out-of-range page selections

## Goal

When a caller passes `--pages`, the extractor must not report success if every requested page is outside the source document. It should fail loudly with the document page count so the agent can correct the page selection instead of treating empty output as useful content.

This is accepted because the user approved executing the KISS fix after CR verification on 2026-05-28.

## Acceptance Criteria

| Case | Expected behavior |
|---|---|
| `--pages` contains only pages greater than the PDF page count | Exit code is `1`, stdout is empty, stderr starts with `pdf-extract:` and includes the source `pageCount`. |
| `--pages` contains at least one page within the PDF page count and at least one out-of-range page | Extraction succeeds for the in-range pages only, preserving the existing partial-selection behavior. |
| `--pages` is omitted | Extraction still attempts every page in the document. |
| `--pages` has invalid syntax | Existing invalid-page syntax errors remain hard failures. |

## Verification

A node:test system check invokes `builtin-skills/pdf-extract/scripts/extract.mjs` with fake gateway dependencies and a two-page fake PDF. The test proves the all-out-of-range case fails and the partial-selection case still succeeds.
