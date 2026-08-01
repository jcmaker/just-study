import type { ReactNode } from "react";

import {
  parseMarkdown,
  type MarkdownBlock,
  type MarkdownInline,
} from "../../server/markdown.ts";

function renderInline(nodes: readonly MarkdownInline[]): ReactNode[] {
  return nodes.map((node, index) => {
    if (node.type === "strong") return <strong key={index}>{node.value}</strong>;
    if (node.type === "emphasis") return <em key={index}>{node.value}</em>;
    if (node.type === "code") {
      return <code key={index} className="radius-sm bg-muted px-1 font-mono text-[0.9em] text-muted-foreground">{node.value}</code>;
    }
    if (node.type === "link") {
      return (
        <a
          key={index}
          href={node.href}
          target="_blank"
          rel="noreferrer"
          className="tap-target inline-flex items-center break-words underline"
        >
          {node.text}
          <span className="sr-only"> (새 창에서 열림)</span>
        </a>
      );
    }
    return <span key={index}>{node.value}</span>;
  });
}

function renderBlock(block: MarkdownBlock, index: number): ReactNode {
  switch (block.type) {
    case "heading": {
      const Heading = `h${Math.min(block.level + 2, 6)}` as "h3" | "h4" | "h5" | "h6";
      return <Heading key={index} className="mt-5 mb-2 break-words font-bold">{renderInline(block.inline)}</Heading>;
    }
    case "paragraph":
      return <p key={index} className="my-3 break-words">{renderInline(block.inline)}</p>;
    case "list":
      return block.ordered ? (
        <ol key={index} className="my-3 list-decimal pl-6">
          {block.items.map((item, itemIndex) => <li key={itemIndex} className="my-1 break-words">{renderInline(item)}</li>)}
        </ol>
      ) : (
        <ul key={index} className="my-3 list-disc pl-6">
          {block.items.map((item, itemIndex) => <li key={itemIndex} className="my-1 break-words">{renderInline(item)}</li>)}
        </ul>
      );
    case "quote":
      return (
        <blockquote key={index} className="my-3 border-l-4 border-solid border-border pl-4 text-muted-foreground">
          {block.lines.map((line, lineIndex) => <p key={lineIndex} className="my-1 break-words">{renderInline(line)}</p>)}
        </blockquote>
      );
    case "code":
      return (
        <pre key={index} className="radius-md my-3 overflow-x-auto bw border-border bg-muted p-3">
          <code className="font-mono text-sm">{block.value}</code>
        </pre>
      );
    case "rule":
      return <hr key={index} className="my-5 border-0 bw-t border-border" />;
    case "table":
      return (
        <div key={index} className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">문서 표</caption>
            <thead>
              <tr>
                {block.header.map((cell, cellIndex) => (
                  <th key={cellIndex} scope="col" style={{ textAlign: block.alignments[cellIndex] }} className="bw border-border p-2 font-bold">
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} style={{ textAlign: block.alignments[cellIndex] }} className="bw border-border p-2 break-words">
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
}

export function MarkdownView({ markdown }: { markdown: string }) {
  let blocks: MarkdownBlock[] | null;
  try {
    blocks = parseMarkdown(markdown);
  } catch {
    blocks = null;
  }
  if (blocks !== null) return <div>{blocks.map(renderBlock)}</div>;
  return (
    <div>
      <p className="mt-0 mb-2 text-sm text-muted-foreground">문서를 서식 있는 형태로 표시하지 못해 원문 그대로 보여 줍니다.</p>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words">{markdown}</pre>
    </div>
  );
}
