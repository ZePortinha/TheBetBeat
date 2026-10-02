import { describe, expect, it } from "vitest";
import {
  ImportError,
  MAX_CSV_ROWS,
  MAX_IMPORT_BYTES,
  parseLibraryCsv,
  parseRekordboxXml,
} from "./import";

const REKORDBOX_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="rekordbox" Version="6.7.4" Company="FictionalDJ"/>
  <COLLECTION Entries="4">
    <TRACK TrackID="101" Name="Midnight Alley" Artist="Vela Nordica"
      Composer="" Album="Fictional LP" Genre="Deep House" Kind="MP3 File"
      Size="9000000" TotalTime="345" AverageBpm="122.00"
      DateAdded="2025-01-01" SampleRate="44100" Comments=""
      Location="file://localhost/C:/music/midnight.mp3" Tonality="Am"
      Label="" Mix="">
      <TEMPO Inizio="0.5" Bpm="122.00" Metro="4/4" Battito="1"/>
    </TRACK>
    <TRACK TrackID="102" Name="Salt &amp; Static &quot;VIP&quot;"
      Artist="Rua &lt;Oitava&gt;" Genre="" AverageBpm="128.50"
      Tonality="F#m" TotalTime="298.7"/>
    <TRACK TrackID="103" Name="Broken Fields" Artist="Kiloma"
      Genre="Techno" AverageBpm="not-a-number" Tonality="H#x"
      TotalTime="-5"/>
    <TRACK TrackID="104" Name="" Artist="Ghost Entry" Genre="House"
      AverageBpm="120.00" Tonality="8A" TotalTime="200"/>
  </COLLECTION>
</DJ_PLAYLISTS>`;

describe("parseRekordboxXml", () => {
  it("parses TRACK attributes and converts Tonality to Camelot", () => {
    const { tracks, skipped } = parseRekordboxXml(REKORDBOX_SAMPLE);

    expect(tracks).toHaveLength(3);
    expect(skipped).toBe(1); // TrackID 104 has no title

    expect(tracks[0]).toEqual({
      title: "Midnight Alley",
      artist: "Vela Nordica",
      genre: "Deep House",
      bpm: 122,
      camelotKey: "8A", // Tonality="Am"
      durationSec: 345,
    });

    // Standard XML entities are decoded; empty genre becomes null.
    expect(tracks[1]).toEqual({
      title: 'Salt & Static "VIP"',
      artist: "Rua <Oitava>",
      genre: null,
      bpm: 128.5,
      camelotKey: "11A", // Tonality="F#m"
      durationSec: 299,
    });

    // Unparseable bpm/key/duration degrade to null, the track is kept.
    expect(tracks[2]).toEqual({
      title: "Broken Fields",
      artist: "Kiloma",
      genre: "Techno",
      bpm: null,
      camelotKey: null,
      durationSec: null,
    });
  });

  it("rejects files containing a DOCTYPE declaration", () => {
    const xml = `<?xml version="1.0"?>
<!DOCTYPE DJ_PLAYLISTS [<!ELEMENT DJ_PLAYLISTS ANY>]>
<DJ_PLAYLISTS><COLLECTION>
  <TRACK Name="Innocent" Artist="A" Tonality="Am"/>
</COLLECTION></DJ_PLAYLISTS>`;
    expect(() => parseRekordboxXml(xml)).toThrowError(ImportError);
    try {
      parseRekordboxXml(xml);
      expect.unreachable();
    } catch (e) {
      expect((e as ImportError).code).toBe("UNSAFE_XML");
    }
  });

  it("rejects files containing ENTITY declarations (XXE / lol)", () => {
    const xml = `<?xml version="1.0"?>
<!doctype foo [ <!entity xxe SYSTEM "file:///etc/passwd"> ]>
<TRACK Name="&xxe;" Artist="A"/>`;
    expect(() => parseRekordboxXml(xml)).toThrowError(ImportError);

    const entityOnly = `<?xml version="1.0"?>
<! ENTITY lol "lol">
<TRACK Name="x" Artist="A"/>`;
    expect(() => parseRekordboxXml(entityOnly)).toThrowError(ImportError);
  });

  it("never expands non-standard entity references", () => {
    // No declaration present (file accepted), reference must stay literal.
    const xml = `<TRACK Name="&lol9; &#x41; song" Artist="A" Tonality="Am"/>`;
    const { tracks } = parseRekordboxXml(xml);
    expect(tracks[0]?.title).toBe("&lol9; &#x41; song");
  });

  it("rejects input larger than 10 MB", () => {
    const huge = "x".repeat(MAX_IMPORT_BYTES + 1);
    try {
      parseRekordboxXml(huge);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ImportError);
      expect((e as ImportError).code).toBe("TOO_LARGE");
    }
  });

  it("handles > inside quoted attribute values", () => {
    const xml = `<TRACK Name="A > B" Artist="C" Tonality="8B" TotalTime="100"/>`;
    const { tracks } = parseRekordboxXml(xml);
    expect(tracks[0]).toMatchObject({
      title: "A > B",
      artist: "C",
      camelotKey: "8B",
    });
  });
});

describe("parseLibraryCsv", () => {
  it("parses header-based rows with quoted fields containing commas", () => {
    const csv = [
      "title,artist,genre,bpm,key,duration_sec",
      '"Love, Later","Dupla, Lda",House,124,Am,301',
      'Plain Song,Solo Act,Techno,132.5,9B,250',
      '"She said ""go""",Quoted Artist,Pop,110,,200',
    ].join("\n");

    const { tracks, skipped } = parseLibraryCsv(csv);
    expect(skipped).toBe(0);
    expect(tracks).toEqual([
      {
        title: "Love, Later",
        artist: "Dupla, Lda",
        genre: "House",
        bpm: 124,
        camelotKey: "8A",
        durationSec: 301,
      },
      {
        title: "Plain Song",
        artist: "Solo Act",
        genre: "Techno",
        bpm: 132.5,
        camelotKey: "9B",
        durationSec: 250,
      },
      {
        title: 'She said "go"',
        artist: "Quoted Artist",
        genre: "Pop",
        bpm: 110,
        camelotKey: null,
        durationSec: 200,
      },
    ]);
  });

  it("is case-insensitive about headers and ignores extra columns", () => {
    const csv = [
      "Artist,TITLE,extra,Key",
      "Someone,Else Song,ignored,10b",
    ].join("\n");
    const { tracks } = parseLibraryCsv(csv);
    expect(tracks).toEqual([
      {
        title: "Else Song",
        artist: "Someone",
        genre: null,
        bpm: null,
        camelotKey: "10B",
        durationSec: null,
      },
    ]);
  });

  it("skips malformed rows and rows without a title", () => {
    const csv = [
      "title,artist,genre,bpm,key,duration_sec",
      "Good One,A,House,120,8A,180",
      "too,few,columns",
      ",NoTitle,House,120,8A,180",
      "Also Good,B,Techno,130,5A,240",
      "", // blank line is ignored, not counted
    ].join("\n");
    const { tracks, skipped } = parseLibraryCsv(csv);
    expect(tracks.map((t) => t.title)).toEqual(["Good One", "Also Good"]);
    expect(skipped).toBe(2);
  });

  it("throws when the title header is missing", () => {
    expect(() => parseLibraryCsv("artist,bpm\nA,120")).toThrowError(
      ImportError,
    );
  });

  it("caps processing at 10000 data rows", () => {
    const rows = ["title,artist,genre,bpm,key,duration_sec"];
    for (let i = 0; i < MAX_CSV_ROWS + 25; i += 1) {
      rows.push(`Track ${i},Artist,House,120,8A,200`);
    }
    const { tracks, skipped } = parseLibraryCsv(rows.join("\n"));
    expect(tracks).toHaveLength(MAX_CSV_ROWS);
    expect(skipped).toBe(25);
  });

  it("rejects input larger than 10 MB", () => {
    const huge = `title\n${"y".repeat(MAX_IMPORT_BYTES)}`;
    try {
      parseLibraryCsv(huge);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ImportError);
      expect((e as ImportError).code).toBe("TOO_LARGE");
    }
  });
});
