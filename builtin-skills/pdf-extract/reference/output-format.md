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

  /** Absolute paths to rendered PNGs; one per extractedPages entry.
   *  Empty array when fallbackImages=false. */
  imagePaths: string[];

  /** Total page count of the source PDF (independent of how many were extracted). */
  pageCount: number;

  /** 1-based page numbers that were extracted after applying --pages, if present. */
  extractedPages: number[];

  /** True when the joined text was clamped to maxChars=200_000. */
  truncatedText: boolean;
};
```

### Example — text PDF

```json
{"text":"OneClaw Quarterly Report ...","fallbackImages":false,"imagePaths":[],"pageCount":12,"extractedPages":[1,2,3,4,5,6,7,8,9,10,11,12],"truncatedText":false}
```

### Example — scanned PDF

```json
{"text":"","fallbackImages":true,"imagePaths":["/var/folders/.../oneclaw-pdf-abc123/page-1.png","/var/folders/.../oneclaw-pdf-abc123/page-2.png"],"pageCount":2,"extractedPages":[1,2],"truncatedText":false}
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
