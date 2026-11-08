import { decodeHTMLAttribute } from 'entities';

import type { LinkLabel } from '../../types';

export interface HtmlImage {
    src: string;
    from: number;
    to: number;
    label: LinkLabel;
}

// Tokenize complete attributes so `alt=` or `src=` inside another value cannot match.
// Supports alt="photo", ALT = 'photo', alt=photo, and a bare alt attribute.
// eslint-disable-next-line sonarjs/regex-complexity -- Consume complete quoted/unquoted values to avoid matching attribute names inside them.
const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;

/** Finds the image tag at a node-relative cursor position and records its alt edit range. */
export function findHtmlImage(html: string, position = 0): HtmlImage | null {
    for (const { from, tag } of readTags(html)) {
        if (!/^<img(?=[\s/>])/i.test(tag)) continue;
        const to = from + tag.length;
        if (position < from || position > to) continue;

        const attributes = readAttributes(tag, from);
        const srcAttribute = attributes.get('src');
        const src = srcAttribute?.plainText ?? '';
        const insertionPoint = srcAttribute?.to ?? from + 4;
        const label = attributes.get('alt');
        return {
            src,
            from,
            to,
            label: label ?? {
                text: '',
                from: insertionPoint,
                to: insertionPoint,
                format: 'htmlAttributeInsertion',
                plainText: '',
            },
        };
    }
    return null;
}

/** Skips comments and consumes complete tags, including quoted angle brackets. */
function* readTags(html: string): Generator<{ from: number; tag: string }> {
    let from = html.indexOf('<');
    while (from !== -1) {
        if (html.startsWith('<!--', from)) {
            const end = html.indexOf('-->', from + 4);
            if (end === -1) return;
            from = html.indexOf('<', end + 3);
            continue;
        }
        const end = findTagEnd(html, from + 1);
        if (end === -1) return;
        yield { from, tag: html.slice(from, end + 1) };
        from = html.indexOf('<', end + 1);
    }
}

function findTagEnd(html: string, from: number): number {
    let quote = '';
    for (let i = from; i < html.length; i++) {
        const char = html[i];
        if (quote) {
            if (char === quote) quote = '';
            continue;
        }
        if (char === '"' || char === "'") quote = char;
        else if (char === '>') return i;
    }
    return -1;
}

/** Reads each attribute once, keeping the first occurrence as HTML does. */
function readAttributes(tag: string, from: number): Map<string, LinkLabel> {
    const attributes = new Map<string, LinkLabel>();
    // A slash directly after an unquoted value belongs to that value in HTML.
    // Skip only <img and >; the tokenizer ignores a standalone closing slash.
    for (const attribute of tag.slice(4, -1).matchAll(ATTRIBUTE)) {
        const name = attribute[1]!.toLowerCase();
        if (attributes.has(name)) continue;
        const rawValue = attribute[2] ?? '';
        const value = /^['"]/.test(rawValue) ? rawValue.slice(1, -1) : rawValue;
        const start = from + 4 + attribute.index;
        attributes.set(name, {
            text: attribute[0],
            from: start,
            to: start + attribute[0].length,
            format: 'htmlAttribute',
            plainText: decodeHTMLAttribute(value),
        });
    }
    return attributes;
}
