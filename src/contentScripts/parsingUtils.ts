import { SyntaxNode } from '@lezer/common';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { LinkContext, CodeContext, LinkType } from '../types';

/**
 * Extracts URL from a Link or Image node by traversing its children
 * Properly handles nested parentheses and special characters
 */
export function extractUrl(node: SyntaxNode, view: EditorView): string | null {
    const cursor = node.cursor();

    // Enter the node
    if (!cursor.firstChild()) return null;

    // Traverse children to find the URL node
    do {
        if (cursor.name === 'URL') {
            return view.state.doc.sliceString(cursor.from, cursor.to);
        }
    } while (cursor.nextSibling());

    return null;
}

/**
 * Parses HTML img tag and extracts src attribute
 * Handles img elements with various attributes
 */
export function parseImageTag(htmlText: string): Omit<LinkContext, 'from' | 'to' | 'contextType'> | null {
    // Check if this is an img tag
    if (!htmlText.match(/<img\s/i)) {
        return null;
    }

    // Extract src attribute value
    const srcMatch = htmlText.match(/\ssrc=["']([^"']+)["']/i);
    if (!srcMatch) {
        return null;
    }

    const url = srcMatch[1];
    return classifyUrl(url);
}

/**
 * Classifies a URL and determines its type
 * @param url - The URL to classify
 * @returns Link context with type, or null if not a supported URL type
 */
export function classifyUrl(url: string): Omit<LinkContext, 'from' | 'to' | 'contextType'> | null {
    // Determine link type
    if (url.match(/^:\/[a-f0-9]{32}(#[^\s]*)?$/i)) {
        return { url, type: LinkType.JoplinResource };
    } else if (url.match(/^mailto:/i)) {
        return { url, type: LinkType.Email };
    } else if (url.match(/^https?:\/\//)) {
        return { url, type: LinkType.ExternalUrl };
    } else if (url.match(/^#[^\s]+$/)) {
        // Internal anchor link (e.g., #heading-slug)
        return { url, type: LinkType.InternalAnchor };
    }

    return null;
}

/**
 * Parses inline code and extracts content
 * Handles backtick-wrapped inline code
 */
export function parseInlineCode(codeText: string): Omit<CodeContext, 'from' | 'to' | 'contextType'> | null {
    // Remove backticks from inline code
    const match = codeText.match(/^`(.+)`$/s);
    if (!match) {
        return null;
    }

    return { code: match[1] };
}

/**
 * Parses code block and extracts content using syntax tree traversal
 * Handles both fenced code blocks (with ``` or ~~~) and indented code blocks (4 spaces/tab)
 * Properly handles nested backticks by extracting only the CodeText nodes
 * Falls back to regex if no CodeText child is found
 */
export function parseCodeBlock(
    node: SyntaxNode,
    view: EditorView
): Omit<CodeContext, 'from' | 'to' | 'contextType'> | null {
    const cursor = node.cursor();

    // Collect ALL CodeText child nodes (for indented blocks with multiple lines)
    const codeTextNodes: string[] = [];
    if (cursor.firstChild()) {
        do {
            if (cursor.name === 'CodeText') {
                const code = view.state.doc.sliceString(cursor.from, cursor.to);
                codeTextNodes.push(code);
            }
        } while (cursor.nextSibling());
    }

    // If we found CodeText nodes, join them
    // Note: CodeText nodes already include trailing newlines, so join with empty string
    if (codeTextNodes.length > 0) {
        return { code: codeTextNodes.join('') };
    }

    // Fallback: If no CodeText child found, use regex to strip fence markers
    // This handles cases where FencedCode is a flat node
    const codeText = view.state.doc.sliceString(node.from, node.to);
    const match = codeText.match(/^```[^\n]*\n([\s\S]*?)```\s*$/m) || codeText.match(/^~~~[^\n]*\n([\s\S]*?)~~~\s*$/m);

    if (!match) {
        return null;
    }

    return { code: match[1] };
}

/**
 * Extracts reference label from a Link node (e.g. "2" from [Google][2])
 */
export function extractReferenceLabel(node: SyntaxNode, view: EditorView): string | null {
    const cursor = node.cursor();
    if (!cursor.firstChild()) return null;

    do {
        if (cursor.name === 'LinkLabel') {
            return view.state.doc.sliceString(cursor.from, cursor.to);
        }
    } while (cursor.nextSibling());

    return null;
}

/**
 * Finds the URL defined for a reference label
 * Scans the document using a cursor to allow early exit
 * Uses the first occurrence if multiple definitions exist with the same label
 */
export function findReferenceDefinition(view: EditorView, label: string): string | null {
    const tree = ensureSyntaxTree(view.state, view.state.doc.length);
    if (!tree) return null;
    const cursor = tree.cursor();

    // Loop through the entire tree in document order
    do {
        if (cursor.name === 'LinkReference') {
            // We found a reference definition. Inspect it using a separate cursor
            // to avoid disrupting our main loop position.
            const refCursor = cursor.node.cursor();

            let defLabel: string | null = null;
            let defUrl: string | null = null;

            // Traverse the children of the LinkReference
            if (refCursor.firstChild()) {
                do {
                    if (refCursor.name === 'LinkLabel') {
                        defLabel = view.state.doc.sliceString(refCursor.from, refCursor.to);
                    } else if (refCursor.name === 'URL') {
                        defUrl = view.state.doc.sliceString(refCursor.from, refCursor.to);
                    }
                } while (refCursor.nextSibling());
            }

            // If this is the match, return immediately (early exit)
            // Note: Reference labels are case-insensitive per CommonMark spec
            if (defLabel !== null && defUrl !== null && defLabel.toLowerCase() === label.toLowerCase()) {
                return defUrl;
            }
        }
    } while (cursor.next());

    return null;
}

/**
 * Finds the definition line for a footnote label (case-insensitive)
 * Returns the position (from) of the definition line
 * Iterates through lines and tracks fenced code block state to skip matches inside code
 */
export function findFootnoteDefinition(view: EditorView, label: string): number | null {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^\\s*\\[\\^${escapedLabel}\\]:`, 'i');

    let lineStart = 0;
    let inFencedCode = false;

    for (const line of view.state.doc.iterLines()) {
        // Track fenced code blocks (``` or ~~~)
        if (/^(`{3,}|~{3,})/.test(line)) {
            inFencedCode = !inFencedCode;
        }

        if (!inFencedCode && pattern.test(line)) {
            const bracketOffset = line.indexOf('[');
            return lineStart + bracketOffset;
        }

        lineStart += line.length + 1; // +1 for newline
    }

    return null;
}
