/**
 * Heading detection and anchor (slug) generation for the markdown editor.
 *
 * The slugify + duplicate-suffix logic is kept intentionally in sync with the
 * joplin-heading-navigator plugin so that generated anchors resolve to the same
 * heading IDs Joplin produces when rendering a note:
 * https://github.com/bwat47/joplin-heading-navigator/blob/main/src/headingExtractor.ts
 *
 * Anchors depend on ALL headings in the note (duplicate slugs receive a `-2`,
 * `-3`, ... suffix in document order), so {@link getHeadingAtPosition} walks the
 * whole syntax tree to build the ordered anchor list before returning the
 * heading under the cursor.
 */

import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { SyntaxNode } from '@lezer/common';
import uslug from '@joplin/fork-uslug';

/**
 * Parses the heading level from a Lezer node name.
 * Handles ATX headings (`ATXHeading1`..`ATXHeading6`) and
 * Setext headings (`SetextHeading1`, `SetextHeading2`).
 * @returns The heading level (1-6), or null if the node is not a heading.
 */
function parseHeadingLevel(nodeName: string): number | null {
    if (nodeName.startsWith('ATXHeading')) {
        const level = Number(nodeName.replace('ATXHeading', ''));
        return Number.isNaN(level) ? null : level;
    }

    if (nodeName.startsWith('SetextHeading')) {
        const level = Number(nodeName.replace('SetextHeading', ''));
        if (level === 1 || level === 2) {
            return level;
        }
    }

    return null;
}

/**
 * Recursively extracts the visible inline text of a heading node, skipping
 * formatting marks, URLs, link labels/titles, images, and HTML tags while
 * preserving escaped characters and the gaps between inline elements.
 */
function extractInlineText(node: SyntaxNode, doc: string): string {
    let out = '';
    const cursor = node.cursor();

    if (!cursor.firstChild()) {
        if (cursor.name === 'Text' || cursor.name === 'CodeText') {
            return doc.slice(cursor.from, cursor.to);
        }
        return '';
    }

    let lastPos = node.from;

    do {
        const name = cursor.name;
        const from = cursor.from;
        const to = cursor.to;

        if (from > lastPos) {
            out += doc.slice(lastPos, from);
        }

        // A URL node is a hidden link destination only inside a Link/Image
        // (e.g. [text](url) / ![alt](url)). A bare URL, email, or autolink target
        // is visible heading text, so it must be kept (matches Joplin's heading IDs).
        const parentName = cursor.node.parent?.name;
        const isLinkDestination = name === 'URL' && (parentName === 'Link' || parentName === 'Image');

        if (
            name.endsWith('Mark') ||
            name === 'HeaderMark' ||
            name === 'Image' ||
            name === 'LinkLabel' ||
            name === 'LinkTitle' ||
            isLinkDestination
        ) {
            lastPos = to;
            continue;
        }

        if (name === 'Escape') {
            out += doc.slice(from + 1, to);
            lastPos = to;
            continue;
        }

        if (name === 'HTMLTag') {
            lastPos = to;
            continue;
        }

        if (name === 'Text' || name === 'CodeText' || name === 'URL') {
            out += doc.slice(from, to);
            lastPos = to;
            continue;
        }

        out += extractInlineText(cursor.node, doc);
        lastPos = to;
    } while (cursor.nextSibling());

    if (lastPos < node.to) {
        out += doc.slice(lastPos, node.to);
    }

    return out;
}

// Matches highlight (==text==) and insert (++text++) formatting, keeping only
// the inner content ($2). Joplin does not include these marks in heading IDs.
const UNSUPPORTED_INLINE_FORMATTING_PATTERN = /(==|\+\+)(?=\S)([\s\S]*?\S)\1/g;

function stripUnsupportedInlineFormatting(text: string): string {
    return text.replace(UNSUPPORTED_INLINE_FORMATTING_PATTERN, '$2');
}

function normalizeHeadingText(node: SyntaxNode, doc: string): string {
    return stripUnsupportedInlineFormatting(extractInlineText(node, doc)).replace(/\s+/g, ' ').trim();
}

/**
 * Converts heading text into a URL-safe anchor, deduplicating against previously
 * seen anchors by appending `-2`, `-3`, ... in document order.
 * @param counts - Mutable map tracking how many times each base anchor has been seen.
 */
function createUniqueAnchor(text: string, fallback: string, counts: Map<string, number>): string {
    const anchorBase = (typeof text === 'string' ? uslug(text) : '') || fallback;
    const previousCount = counts.get(anchorBase);
    if (previousCount === undefined) {
        counts.set(anchorBase, 1);
        return anchorBase;
    }
    counts.set(anchorBase, previousCount + 1);
    return `${anchorBase}-${previousCount + 1}`;
}

/**
 * Finds the heading whose range contains the given position and returns its
 * normalized text and unique anchor. Walks every heading in the document first
 * so duplicate-slug suffixes match what Joplin renders.
 *
 * @param view - CodeMirror 6 EditorView instance
 * @param pos - Cursor position to check
 * @returns The heading text and anchor, or null if the position is not on a heading.
 */
export function getHeadingAtPosition(view: EditorView, pos: number): { text: string; anchor: string } | null {
    const tree = syntaxTree(view.state);
    const doc = view.state.doc.toString();
    const anchorCounts = new Map<string, number>();

    let match: { text: string; anchor: string } | null = null;

    tree.iterate({
        enter(node) {
            const level = parseHeadingLevel(node.type.name);
            if (level === null) {
                return;
            }

            const text = normalizeHeadingText(node.node, doc);
            if (!text) {
                return;
            }

            const anchor = createUniqueAnchor(text, `heading-${node.from}`, anchorCounts);

            // Headings can't nest, so we keep building the full ordered anchor list
            // (for correct duplicate suffixes) while recording the one under the cursor.
            if (pos >= node.from && pos <= node.to) {
                match = { text, anchor };
            }
        },
    });

    return match;
}
