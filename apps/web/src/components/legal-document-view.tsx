import Link from "next/link";
import type { ReactNode } from "react";
import { DomigooShell } from "@/components/domigoo-shell";
import { getWebServerConfig } from "@/lib/env";
import {
  LEGAL_DOC_MAP,
  parseMarkdownBlocks,
  readLegalMarkdown,
  type LegalDocSlug,
} from "@/lib/legal";

function mapLegalHref(href: string): string {
  if (href.endsWith("terminos-y-condiciones.md")) return "/legal/terminos";
  if (href.endsWith("politica-tratamiento-datos.md")) return "/legal/privacidad";
  if (href.endsWith("terminos-domiciliarios.md")) return "/legal/domiciliarios";
  if (href.endsWith("terminos-restaurantes.md")) return "/legal/restaurantes";
  if (href.endsWith("autorizacion-tratamiento-datos.md")) return "/legal/autorizacion";
  return href;
}

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <code
          key={key++}
          style={{
            backgroundColor: "#f1f5f9",
            padding: "1px 4px",
            borderRadius: "4px",
            fontSize: "0.9em",
          }}
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (linkMatch) {
        const label = linkMatch[1] ?? "";
        const href = mapLegalHref(linkMatch[2] ?? "#");
        if (href.startsWith("/")) {
          parts.push(
            <Link key={key++} href={href} style={{ color: "#1d4ed8", textDecoration: "underline" }}>
              {label}
            </Link>,
          );
        } else {
          parts.push(
            <a
              key={key++}
              href={href}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#1d4ed8", textDecoration: "underline" }}
            >
              {label}
            </a>,
          );
        }
      } else {
        parts.push(token);
      }
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

export function LegalDocumentView({ slug }: { slug: LegalDocSlug }) {
  const { appName, adminAppUrl } = getWebServerConfig();
  const markdown = readLegalMarkdown(slug);
  const blocks = parseMarkdownBlocks(markdown);

  return (
    <DomigooShell appName={appName} adminAppUrl={adminAppUrl} activeRoute="legal">
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <div style={{ marginBottom: 16 }}>
          <Link href="/" style={{ color: "#1d4ed8", textDecoration: "underline", fontSize: 14 }}>
            ← Volver al inicio
          </Link>
        </div>

        <div
          role="status"
          data-testid="legal-draft-banner"
          style={{
            backgroundColor: "#fef3c7",
            border: "1px solid #f59e0b",
            color: "#92400e",
            borderRadius: 8,
            padding: "12px 16px",
            marginBottom: 24,
            fontWeight: 600,
          }}
        >
          Borrador en revisión legal — Estos textos son un borrador de trabajo pendiente de revisión
          por abogado colombiano antes de su publicación definitiva.
        </div>

        <nav
          aria-label="Documentos legales"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            marginBottom: 24,
            paddingBottom: 12,
            borderBottom: "1px solid #e2e8f0",
            fontSize: 14,
          }}
        >
          {(Object.keys(LEGAL_DOC_MAP) as LegalDocSlug[]).map((itemSlug) => {
            const item = LEGAL_DOC_MAP[itemSlug];
            const isCurrent = itemSlug === slug;
            return (
              <Link
                key={itemSlug}
                href={item.route}
                style={{
                  color: isCurrent ? "#0f172a" : "#1d4ed8",
                  fontWeight: isCurrent ? 700 : 400,
                  textDecoration: isCurrent ? "none" : "underline",
                }}
              >
                {item.title}
              </Link>
            );
          })}
        </nav>

        <article
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            padding: "28px 24px",
            lineHeight: 1.65,
          }}
        >
          {blocks.map((block, idx) => {
            if (block.type === "hr") {
              return (
                <hr
                  key={idx}
                  style={{ border: 0, borderTop: "1px solid #e2e8f0", margin: "20px 0" }}
                />
              );
            }
            if (block.type === "heading") {
              if (block.level === 1) {
                return (
                  <h1 key={idx} style={{ fontSize: 26, margin: "0 0 16px" }}>
                    {renderInline(block.text)}
                  </h1>
                );
              }
              if (block.level === 2) {
                return (
                  <h2 key={idx} style={{ fontSize: 20, margin: "24px 0 10px" }}>
                    {renderInline(block.text)}
                  </h2>
                );
              }
              return (
                <h3 key={idx} style={{ fontSize: 17, margin: "18px 0 8px" }}>
                  {renderInline(block.text)}
                </h3>
              );
            }
            if (block.type === "blockquote") {
              return (
                <blockquote
                  key={idx}
                  style={{
                    margin: "14px 0",
                    padding: "10px 14px",
                    borderLeft: "4px solid #cbd5e1",
                    backgroundColor: "#f8fafc",
                  }}
                >
                  {block.lines.map((line, lIdx) => (
                    <p key={lIdx} style={{ margin: "4px 0" }}>
                      {renderInline(line)}
                    </p>
                  ))}
                </blockquote>
              );
            }
            if (block.type === "list") {
              const Tag = block.ordered ? "ol" : "ul";
              return (
                <Tag key={idx} style={{ margin: "12px 0", paddingLeft: 24 }}>
                  {block.items.map((item, itemIdx) => (
                    <li key={itemIdx} style={{ marginBottom: 6 }}>
                      {renderInline(item)}
                    </li>
                  ))}
                </Tag>
              );
            }
            if (block.type === "table") {
              return (
                <div key={idx} className="dg-legal-table-wrap">
                  <table className="dg-legal-table">
                    <thead>
                      <tr>
                        {block.headers.map((header, hIdx) => (
                          <th key={hIdx}>{renderInline(header)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row, rIdx) => (
                        <tr key={rIdx}>
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} data-label={block.headers[cIdx] ?? ""}>
                              {renderInline(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }
            return (
              <p key={idx} style={{ margin: "10px 0" }}>
                {renderInline(block.text)}
              </p>
            );
          })}
        </article>
      </div>
    </DomigooShell>
  );
}
