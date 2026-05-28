# Output format

## stdout

Exactly **one line** of JSON terminated by `\n`. No banner, no progress, no
trailing log lines. This makes the output trivially parseable by the caller.

### Schema

```ts
type Output = {
  /** Joined text from extracted pages. May be "" when fallbackImages=true. */
  text: string;

  /** True when the extracted text was below minTextChars and pages were
   *  rendered to PNG files instead. */
  fallbackImages: boolean;

  /** Absolute paths to rendered PNGs in a unique per-run directory; one per extractedPages entry.
   *  Empty array when fallbackImages=false. */
  imagePaths: string[];

  /** Total page count of the source PDF (independent of how many were extracted). */
  pageCount: number;

  /** 1-based page numbers whose full text is included in `text`, after applying
   *  --pages. Pages with no extractable text are omitted. In text mode, when the
   *  maxChars budget is reached, reading stops and the page that could not be
   *  included in full is omitted — so a truncated run lists only fully-included
   *  pages. In image mode (fallbackImages=true) it lists every rendered page,
   *  one per imagePaths entry. */
  extractedPages: number[];

  /** True when `text` does not contain the complete text of every requested
   *  in-range page — i.e. a page was clamped or reading stopped at the
   *  maxChars=200_000 budget before all pages were read. */
  truncatedText: boolean;
};
```

### Example — text PDF

```json
{"text":"OneClaw Quarterly Report ...","fallbackImages":false,"imagePaths":[],"pageCount":12,"extractedPages":[1,2,3,4,5,6,7,8,9,10,11,12],"truncatedText":false}
```

### Example — scanned PDF

```json
{"text":"","fallbackImages":true,"imagePaths":["/var/folders/.../oneclaw-pdf-abc123-12345-deadbeef/page-1.png","/var/folders/.../oneclaw-pdf-abc123-12345-deadbeef/page-2.png"],"pageCount":2,"extractedPages":[1,2],"truncatedText":false}
```

## stderr

Only used for errors. Format: `pdf-extract: <message>\n`. Exit code is `1` for
any error. There are no warnings on stderr in the success path.

## Exit codes

| Code | Meaning                                            |
|------|----------------------------------------------------|
| `0`  | Success — one JSON line on stdout.                 |
| `1`  | Any failure (missing file, size cap, lib missing). |

No other exit codes are used.
