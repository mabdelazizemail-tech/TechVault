import { describe, expect, it } from "vitest";
import {
  MAX_FILE_BYTES,
  cleanFileName,
  formatBytes,
  matchesContent,
  ruleFor,
} from "@/modules/innovation/domain/files";
import {
  excerptOf,
  toAnyWordQuery,
  toPrefixQuery,
} from "@/modules/innovation/domain/search";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

describe("toPrefixQuery", () => {
  it("matches every word as a prefix", () => {
    expect(toPrefixQuery("OCR deploy")).toBe("ocr:* & deploy:*");
  });

  it("drops operators and punctuation, so the result is always a safe tsquery", () => {
    expect(toPrefixQuery("ocr & !banking | (x:*)")).toBe("ocr:* & banking:* & x:*");
    expect(toPrefixQuery("'; drop table --")).toBe("drop:* & table:*");
  });

  it("keeps Arabic words", () => {
    expect(toPrefixQuery("مشروع البنك")).toBe("مشروع:* & البنك:*");
  });

  it("returns null when nothing searchable remains, and caps the number of words", () => {
    expect(toPrefixQuery("  !!! ")).toBeNull();
    expect(toPrefixQuery(undefined)).toBeNull();
    expect(toPrefixQuery("a b c d e f g h")?.split(" & ")).toHaveLength(6);
  });
});

describe("toAnyWordQuery", () => {
  it("keeps the meaningful words of a question and lets any of them match", () => {
    expect(
      toAnyWordQuery("How did we solve the OCR problem in our previous project?"),
    ).toBe("solve:* | ocr:* | problem:* | previous:* | project:*");
  });

  it("drops Arabic stop words too, and returns null for a question of only common words", () => {
    expect(toAnyWordQuery("كيف تم حل مشكلة التعرف")).toBe("حل:* | مشكلة:* | التعرف:*");
    expect(toAnyWordQuery("what is this?")).toBeNull();
  });
});

describe("excerptOf", () => {
  it("flattens whitespace and truncates", () => {
    expect(excerptOf("one\n\ntwo")).toBe("one two");
    expect(excerptOf("x".repeat(300), 10)).toHaveLength(10);
    expect(excerptOf(null)).toBe("");
  });
});

describe("file acceptance", () => {
  it("accepts a file only when its content matches its extension", () => {
    expect(matchesContent("guide.pdf", text("%PDF-1.7 ..."))).toBe(true);
    expect(matchesContent("guide.pdf", bytes(0x4d, 0x5a, 0x90, 0x00))).toBe(false);
    expect(
      matchesContent("photo.PNG", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
    ).toBe(true);
    expect(matchesContent("report.docx", bytes(0x50, 0x4b, 0x03, 0x04))).toBe(true);
    expect(
      matchesContent("old.xls", bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)),
    ).toBe(true);
  });

  it("refuses an executable renamed to a text file, and unknown extensions", () => {
    expect(matchesContent("notes.txt", bytes(0x4d, 0x5a, 0x00, 0x00))).toBe(false);
    expect(matchesContent("notes.txt", text("Plain notes, including café"))).toBe(true);
    expect(ruleFor("setup.exe")).toBeNull();
    expect(matchesContent("setup.exe", text("anything"))).toBe(false);
  });

  it("only previews PDFs and images inline", () => {
    expect(ruleFor("a.pdf")?.preview).toBe("pdf");
    expect(ruleFor("a.jpeg")?.preview).toBe("image");
    expect(ruleFor("a.docx")?.preview).toBeNull();
  });

  it("cleans directory parts and control characters from names", () => {
    expect(cleanFileName("C:\\Users\\me\\..\\Contract.pdf")).toBe("Contract.pdf");
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("bad\u0000name.pdf")).toBe("badname.pdf");
  });

  it("formats sizes for people", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(MAX_FILE_BYTES)).toBe("25.0 MB");
  });
});
