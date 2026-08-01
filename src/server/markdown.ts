export type MarkdownInline =
  | { type: "text"; value: string }
  | { type: "strong"; value: string }
  | { type: "emphasis"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; href: string; text: string };

export type MarkdownAlignment = "left" | "center" | "right";

export type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; inline: MarkdownInline[] }
  | { type: "paragraph"; inline: MarkdownInline[] }
  | { type: "list"; ordered: boolean; items: MarkdownInline[][] }
  | { type: "quote"; lines: MarkdownInline[][] }
  | { type: "code"; language: string | null; value: string }
  | { type: "table"; header: MarkdownInline[][]; alignments: MarkdownAlignment[]; rows: MarkdownInline[][][] }
  | { type: "rule" };

const INLINE_PATTERN = /(!?\[[^\]\n]*\]\([^\s()]*\))|(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/;
const LINK_PATTERN = /^\[([^\]\n]*)\]\(([^\s()]*)\)$/;

function safeLinkHref(candidate: string): string | null {
  if (candidate === "") return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
}

function pushText(target: MarkdownInline[], value: string): void {
  const literal = value.replace(/\\\|/g, "|");
  if (literal === "") return;
  const last = target.at(-1);
  if (last?.type === "text") last.value += literal;
  else target.push({ type: "text", value: literal });
}

export function parseInline(source: string): MarkdownInline[] {
  const result: MarkdownInline[] = [];
  let rest = source;

  while (rest.length > 0) {
    const match = INLINE_PATTERN.exec(rest);
    if (!match) {
      pushText(result, rest);
      break;
    }
    pushText(result, rest.slice(0, match.index));
    const token = match[0]!;
    rest = rest.slice(match.index + token.length);

    if (token.startsWith("`")) {
      result.push({ type: "code", value: token.slice(1, -1) });
      continue;
    }
    if (token.startsWith("**")) {
      result.push({ type: "strong", value: token.slice(2, -2) });
      continue;
    }
    if (token.startsWith("*")) {
      result.push({ type: "emphasis", value: token.slice(1, -1) });
      continue;
    }
    const link = LINK_PATTERN.exec(token.startsWith("!") ? token.slice(1) : token);
    const href = link === null ? null : safeLinkHref(link[2]!.trim());
    if (link === null || href === null || link[1]!.trim() === "") {
      pushText(result, token);
      continue;
    }
    result.push({ type: "link", href, text: link[1]! });
  }

  return result;
}

function tableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of trimmed) {
    if (escaped) {
      cell += character === "|" ? "|" : `\\${character}`;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(`${cell}${escaped ? "\\" : ""}`.trim());
  return cells;
}

function alignmentOf(cell: string): MarkdownAlignment | null {
  if (!/^:?-{1,}:?$/.test(cell)) return null;
  if (cell.startsWith(":") && cell.endsWith(":")) return "center";
  if (cell.endsWith(":")) return "right";
  return "left";
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const fence = /^```(.*)$/.exec(line);
    if (fence) {
      const language = fence[1]!.trim();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index]!)) {
        body.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language: language === "" ? null : language, value: body.join("\n") });
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6,
        inline: parseInline(heading[2]!.trim()),
      });
      index += 1;
      continue;
    }

    if (line.trimStart().startsWith(">")) {
      const quoteLines: MarkdownInline[][] = [];
      while (index < lines.length && lines[index]!.trimStart().startsWith(">")) {
        quoteLines.push(parseInline(lines[index]!.trimStart().replace(/^>\s?/, "")));
        index += 1;
      }
      blocks.push({ type: "quote", lines: quoteLines });
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d{1,9}[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = bullet === null;
      const items: MarkdownInline[][] = [];
      while (index < lines.length) {
        const current = lines[index]!;
        const next = ordered ? /^\s*\d{1,9}[.)]\s+(.*)$/.exec(current) : /^\s*[-*+]\s+(.*)$/.exec(current);
        if (!next) break;
        items.push(parseInline(next[1]!.trim()));
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && lines[index + 1]!.includes("-")) {
      const header = tableCells(line);
      const alignmentCells = tableCells(lines[index + 1]!);
      const alignments = alignmentCells.map(alignmentOf);
      if (alignments.length === header.length && alignments.every((value) => value !== null)) {
        let rowIndex = index + 2;
        const rows: string[][] = [];
        let valid = true;
        while (rowIndex < lines.length && lines[rowIndex]!.includes("|") && lines[rowIndex]!.trim() !== "") {
          const cells = tableCells(lines[rowIndex]!);
          if (cells.length !== header.length) {
            valid = false;
            break;
          }
          rows.push(cells);
          rowIndex += 1;
        }
        if (valid) {
          blocks.push({
            type: "table",
            header: header.map((cell) => parseInline(cell)),
            alignments: alignments as MarkdownAlignment[],
            rows: rows.map((row) => row.map(parseInline)),
          });
          index = rowIndex;
          continue;
        }
      }
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index]!;
      if (
        current.trim() === "" ||
        /^```/.test(current) ||
        /^#{1,6}\s/.test(current) ||
        current.trimStart().startsWith(">") ||
        /^\s*[-*+]\s+/.test(current) ||
        /^\s*\d{1,9}[.)]\s+/.test(current) ||
        /^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(current.trim())
      ) break;
      paragraph.push(current.trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", inline: parseInline(paragraph.join(" ")) });
  }

  return blocks;
}
