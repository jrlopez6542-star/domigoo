import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type LegalDocSlug =
  "terminos" | "privacidad" | "domiciliarios" | "restaurantes" | "autorizacion";

export const LEGAL_DOC_MAP: Record<LegalDocSlug, { file: string; title: string; route: string }> = {
  terminos: {
    file: "terminos-y-condiciones.md",
    title: "Términos y Condiciones",
    route: "/legal/terminos",
  },
  privacidad: {
    file: "politica-tratamiento-datos.md",
    title: "Política de Tratamiento de Datos Personales",
    route: "/legal/privacidad",
  },
  domiciliarios: {
    file: "terminos-domiciliarios.md",
    title: "Términos para Domiciliarios Independientes",
    route: "/legal/domiciliarios",
  },
  restaurantes: {
    file: "terminos-restaurantes.md",
    title: "Términos para Restaurantes",
    route: "/legal/restaurantes",
  },
  autorizacion: {
    file: "autorizacion-tratamiento-datos.md",
    title: "Autorización para el Tratamiento de Datos Personales",
    route: "/legal/autorizacion",
  },
};

export function resolveLegalDocsDir(): string {
  const candidates = [
    resolve(process.cwd(), "../../docs/legal"),
    resolve(process.cwd(), "docs/legal"),
    resolve(process.cwd(), "../docs/legal"),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) {
      return dir;
    }
  }
  throw new Error("No se encontró el directorio docs/legal");
}

export function readLegalMarkdown(slug: LegalDocSlug): string {
  const meta = LEGAL_DOC_MAP[slug];
  const filePath = resolve(resolveLegalDocsDir(), meta.file);
  return readFileSync(filePath, "utf8");
}

export type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { type: "blockquote"; lines: string[] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "hr" }
  | { type: "paragraph"; text: string };

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i] ?? "";
    const trimmed = rawLine.trim();

    if (trimmed === "") {
      i += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch !== null) {
      const level = headingMatch[1]?.length as 1 | 2 | 3 | 4;
      blocks.push({ type: "heading", level, text: headingMatch[2] ?? "" });
      i += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith(">")) {
        quoteLines.push((lines[i] ?? "").trim().replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "blockquote", lines: quoteLines });
      continue;
    }

    if (
      trimmed.startsWith("|") &&
      i + 1 < lines.length &&
      /^\|[\s:-]+\|/.test((lines[i + 1] ?? "").trim())
    ) {
      const splitRow = (row: string): string[] =>
        row
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => cell.trim());

      const headers = splitRow(trimmed);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|")) {
        rows.push(splitRow(lines[i] ?? ""));
        i += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const ordered = /^\d+\.\s+/.test(trimmed);
      const items: string[] = [];
      while (
        i < lines.length &&
        (ordered
          ? /^\d+\.\s+/.test((lines[i] ?? "").trim())
          : /^[-*]\s+/.test((lines[i] ?? "").trim()))
      ) {
        items.push((lines[i] ?? "").trim().replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length) {
      const current = (lines[i] ?? "").trim();
      if (
        current === "" ||
        /^#{1,4}\s+/.test(current) ||
        current.startsWith(">") ||
        /^---+$/.test(current) ||
        /^[-*]\s+/.test(current) ||
        /^\d+\.\s+/.test(current) ||
        current.startsWith("|")
      ) {
        break;
      }
      paraLines.push(current);
      i += 1;
    }
    blocks.push({ type: "paragraph", text: paraLines.join(" ") });
  }

  return blocks;
}
