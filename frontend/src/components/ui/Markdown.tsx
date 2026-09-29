import React from 'react';

/**
 * Small, dependency-free markdown renderer for AI answers and reports.
 * Supports headings, bullet/numbered lists, bold, italics, inline code, links, and horizontal rules.
 * Output is built from React nodes (no dangerouslySetInnerHTML), so model output can't inject HTML.
 */

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Order matters: code, link, bold, italic
  const pattern = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (tok.startsWith('`')) {
      nodes.push(<code key={key} className="px-1.5 py-0.5 rounded-md bg-slate-100 text-sky-800 font-mono text-[0.85em]">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('[')) {
      const label = tok.slice(1, tok.indexOf(']'));
      const href = tok.slice(tok.indexOf('(') + 1, -1);
      const safe = /^(https?:\/\/|\/)/i.test(href) ? href : '#';
      nodes.push(
        <a key={key} href={safe} target="_blank" rel="noreferrer" className="text-sky-700 underline underline-offset-2 hover:text-sky-900">
          {label}
        </a>
      );
    } else if (tok.startsWith('**')) {
      nodes.push(<strong key={key} className="font-bold text-slate-900">{renderInline(tok.slice(2, -2), key)}</strong>);
    } else {
      nodes.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export const Markdown: React.FC<{ content: string; className?: string }> = ({ content, className = '' }) => {
  const lines = (content || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      const k = `p-${blocks.length}`;
      blocks.push(<p key={k} className="leading-relaxed">{renderInline(para.join(' '), k)}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const k = `l-${blocks.length}`;
      const items = list.items.map((it, idx) => <li key={idx}>{renderInline(it, `${k}-${idx}`)}</li>);
      blocks.push(
        list.ordered
          ? <ol key={k} className="list-decimal pl-5 space-y-1">{items}</ol>
          : <ul key={k} className="list-disc pl-5 space-y-1 marker:text-sky-500">{items}</ul>
      );
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    const bullet = /^[-*•]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);

    if (!trimmed) {
      flushPara();
      flushList();
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara(); flushList();
      blocks.push(<hr key={`hr-${blocks.length}`} className="my-2 border-slate-200" />);
    } else if (heading) {
      flushPara(); flushList();
      const level = heading[1].length;
      const k = `h-${blocks.length}`;
      const cls = level === 1
        ? 'text-2xl font-extrabold text-slate-900 tracking-tight'
        : level === 2
        ? 'text-lg font-extrabold text-slate-900 mt-2'
        : 'text-base font-bold text-slate-900 mt-1';
      blocks.push(React.createElement(`h${Math.min(level + 1, 6)}`, { key: k, className: cls }, renderInline(heading[2], k)));
    } else if (bullet || numbered) {
      flushPara();
      const ordered = !!numbered;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet || numbered)![1]);
    } else {
      flushList();
      para.push(trimmed);
    }
  }
  flushPara();
  flushList();

  return <div className={`space-y-2.5 text-slate-700 ${className}`}>{blocks}</div>;
};
