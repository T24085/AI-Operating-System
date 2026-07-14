import { Fragment, type ReactNode } from "react";

const linkPattern = /(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<]+)/gi;
const boldPattern = /(\*\*[^*\n]+\*\*)/g;
const trailingPunctuation = /[.,;:!?]+$/;

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function textNodes(value: string, key: string): ReactNode[] {
  return value.split(boldPattern).map((part, index) => part.startsWith("**") && part.endsWith("**")
    ? <strong key={`${key}-bold-${index}`}>{part.slice(2, -2)}</strong>
    : <Fragment key={`${key}-text-${index}`}>{part}</Fragment>);
}

export function SafeMessageText({ content }: { content: string }) {
  return <>{content.split(linkPattern).map((part, index) => {
    const markdown = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/i);
    if (markdown) {
      const href = safeHttpUrl(markdown[2]);
      return href ? <a className="safe-message-link" href={href} target="_blank" rel="noopener noreferrer" key={`link-${index}`}>{markdown[1]}</a> : <Fragment key={`plain-${index}`}>{part}</Fragment>;
    }

    if (/^https?:\/\//i.test(part)) {
      const punctuation = part.match(trailingPunctuation)?.[0] ?? "";
      const rawUrl = punctuation ? part.slice(0, -punctuation.length) : part;
      const href = safeHttpUrl(rawUrl);
      return href ? <Fragment key={`url-${index}`}><a className="safe-message-link" href={href} target="_blank" rel="noopener noreferrer">{rawUrl}</a>{punctuation}</Fragment> : <Fragment key={`plain-${index}`}>{part}</Fragment>;
    }

    return <Fragment key={`chunk-${index}`}>{textNodes(part, `chunk-${index}`)}</Fragment>;
  })}</>;
}
