/**
 * DJ library import (B4.6): rekordbox XML and generic CSV parsers.
 *
 * Security (B12.4 uploads):
 * - Input larger than 10 MB (UTF-8 byte length) is rejected outright.
 * - The XML "parser" is a minimal hand-rolled attribute extractor over
 *   `<TRACK …>` elements. It never builds a DOM and never processes DTDs or
 *   entity definitions: any `<!DOCTYPE` / `<!ENTITY` rejects the whole file
 *   (no XXE / billion-laughs surface). Only the five standard XML character
 *   entities are decoded.
 * - CSV parsing is header-based, bounded to 10 000 data rows.
 *
 * Pure module: no I/O, no clock, no environment access.
 */
import { parseCamelot } from "./camelot";

/** One track parsed from a DJ library file. */
export interface ImportedTrack {
  title: string;
  artist: string;
  genre: string | null;
  bpm: number | null;
  camelotKey: string | null;
  durationSec: number | null;
}

/** Parse outcome: accepted tracks plus how many rows/elements were skipped. */
export interface ImportResult {
  tracks: ImportedTrack[];
  skipped: number;
}

export type ImportErrorCode =
  /** Input exceeds MAX_IMPORT_BYTES. */
  | "TOO_LARGE"
  /** XML contains a DOCTYPE or ENTITY declaration (potential XXE). */
  | "UNSAFE_XML"
  /** CSV header row is missing the required `title` column. */
  | "MISSING_HEADER";

/** Thrown when the whole file must be rejected (never for a single bad row). */
export class ImportError extends Error {
  readonly code: ImportErrorCode;

  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.name = "ImportError";
    this.code = code;
  }
}

/** Maximum accepted library upload size (B12.4): 10 MB. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** Maximum number of CSV data rows processed; the rest are counted skipped. */
export const MAX_CSV_ROWS = 10_000;

/** Sanity bounds — values outside become null rather than poisoning pricing. */
const MAX_SANE_BPM = 400;
const MAX_SANE_DURATION_SEC = 6 * 60 * 60; // 6 hours

function assertWithinSizeLimit(input: string): void {
  // UTF-8 byte length is always >= UTF-16 code-unit length, so a cheap
  // length check short-circuits before encoding very large strings.
  if (
    input.length > MAX_IMPORT_BYTES ||
    new TextEncoder().encode(input).byteLength > MAX_IMPORT_BYTES
  ) {
    throw new ImportError(
      "TOO_LARGE",
      `Library file exceeds the ${MAX_IMPORT_BYTES / (1024 * 1024)} MB limit`,
    );
  }
}

/** Decode ONLY the five standard XML entities; anything else stays literal. */
const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(amp|lt|gt|quot|apos);/g,
    (_, name: string) => XML_ENTITIES[name] ?? "",
  );
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function parseBpm(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0 || n > MAX_SANE_BPM) return null;
  // rekordbox exports "128.00"; keep one decimal of real precision.
  return Math.round(n * 100) / 100;
}

function parseDurationSec(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0 || n > MAX_SANE_DURATION_SEC) return null;
  return Math.round(n);
}

// ---------------------------------------------------------------------------
// rekordbox XML
// ---------------------------------------------------------------------------

/**
 * Matches an opening/self-closing `<TRACK …>` tag. Quoted attribute values are
 * consumed wholesale so a literal `>` inside a value cannot end the tag early.
 * The alternatives start with disjoint characters, so no backtracking blowup.
 */
const TRACK_TAG_RE = /<TRACK\b((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/gi;

/** `Name="value"` or `Name='value'` pairs inside a tag's attribute block. */
const ATTRIBUTE_RE = /([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const UNSAFE_XML_RE = /<!\s*(?:DOCTYPE|ENTITY)/i;

function extractAttributes(attrBlock: string): Map<string, string> {
  const attrs = new Map<string, string>();
  ATTRIBUTE_RE.lastIndex = 0;
  for (const m of attrBlock.matchAll(ATTRIBUTE_RE)) {
    const name = m[1];
    const value = m[2] ?? m[3] ?? "";
    if (name !== undefined && !attrs.has(name)) {
      attrs.set(name, decodeXmlEntities(value));
    }
  }
  return attrs;
}

/**
 * Parse a rekordbox collection XML export.
 *
 * Reads only the `Name`, `Artist`, `Genre`, `AverageBpm`, `Tonality` and
 * `TotalTime` attributes of each `<TRACK>` element. Tracks without a title
 * are counted in `skipped`. Files containing `<!DOCTYPE` or `<!ENTITY`, or
 * larger than 10 MB, are rejected with an {@link ImportError}.
 */
export function parseRekordboxXml(xml: string): ImportResult {
  assertWithinSizeLimit(xml);
  if (UNSAFE_XML_RE.test(xml)) {
    throw new ImportError(
      "UNSAFE_XML",
      "XML files with DOCTYPE or ENTITY declarations are not accepted",
    );
  }

  const tracks: ImportedTrack[] = [];
  let skipped = 0;

  TRACK_TAG_RE.lastIndex = 0;
  for (const match of xml.matchAll(TRACK_TAG_RE)) {
    const attrs = extractAttributes(match[1] ?? "");
    const title = attrs.get("Name")?.trim() ?? "";
    if (title.length === 0) {
      skipped += 1;
      continue;
    }
    tracks.push({
      title,
      artist: attrs.get("Artist")?.trim() ?? "",
      genre: emptyToNull(attrs.get("Genre")),
      bpm: parseBpm(attrs.get("AverageBpm")),
      camelotKey: parseCamelot(attrs.get("Tonality")),
      durationSec: parseDurationSec(attrs.get("TotalTime")),
    });
  }

  return { tracks, skipped };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Minimal RFC 4180 record scanner: double-quoted fields may contain commas,
 * newlines and `""` escapes. Returns at most `maxRecords` records and the
 * count of data records beyond the cap.
 */
function scanCsvRecords(
  text: string,
  maxRecords: number,
): { records: string[][]; overflow: number } {
  const records: string[][] = [];
  let overflow = 0;
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // Ignore fully empty records (e.g. trailing newline).
    const isEmpty = row.length === 1 && row[0] === "";
    if (!isEmpty) {
      if (records.length < maxRecords) {
        records.push(row);
      } else {
        overflow += 1;
      }
    }
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1; // escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      pushRow();
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();

  return { records, overflow };
}

const CSV_COLUMNS = [
  "title",
  "artist",
  "genre",
  "bpm",
  "key",
  "duration_sec",
] as const;

type CsvColumn = (typeof CSV_COLUMNS)[number];

/**
 * Parse a DJ library CSV with the header columns
 * `title,artist,genre,bpm,key,duration_sec` (any order, case-insensitive;
 * extra columns ignored). Quoted fields may contain commas. Malformed rows
 * (wrong field count or empty title) are skipped, processing is capped at
 * {@link MAX_CSV_ROWS} data rows, and files larger than 10 MB are rejected.
 */
export function parseLibraryCsv(csv: string): ImportResult {
  assertWithinSizeLimit(csv);

  // +1: the first record is the header, not a data row.
  const { records, overflow } = scanCsvRecords(csv, MAX_CSV_ROWS + 1);
  const header = records[0];
  if (!header) {
    throw new ImportError("MISSING_HEADER", "CSV file is empty");
  }

  const columnIndex = new Map<CsvColumn, number>();
  header.forEach((rawName, index) => {
    // Strip a UTF-8 BOM that survives on the first header cell.
    const name = rawName.replace(/^﻿/, "").trim().toLowerCase();
    if (
      (CSV_COLUMNS as readonly string[]).includes(name) &&
      !columnIndex.has(name as CsvColumn)
    ) {
      columnIndex.set(name as CsvColumn, index);
    }
  });
  if (!columnIndex.has("title")) {
    throw new ImportError(
      "MISSING_HEADER",
      'CSV header must include a "title" column',
    );
  }

  const cell = (row: string[], column: CsvColumn): string | undefined => {
    const index = columnIndex.get(column);
    return index === undefined ? undefined : row[index];
  };

  const tracks: ImportedTrack[] = [];
  let skipped = overflow;

  for (const row of records.slice(1)) {
    if (row.length !== header.length) {
      skipped += 1;
      continue;
    }
    const title = cell(row, "title")?.trim() ?? "";
    if (title.length === 0) {
      skipped += 1;
      continue;
    }
    tracks.push({
      title,
      artist: cell(row, "artist")?.trim() ?? "",
      genre: emptyToNull(cell(row, "genre")),
      bpm: parseBpm(cell(row, "bpm")),
      camelotKey: parseCamelot(cell(row, "key")),
      durationSec: parseDurationSec(cell(row, "duration_sec")),
    });
  }

  return { tracks, skipped };
}
