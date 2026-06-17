import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { SyntaxNode } from '@lezer/common';

export interface ExtractedQuote {
    text: string;
    from: number;
    to: number;
}

function findOutermostBlockquoteAtPosition(view: EditorView, pos: number): SyntaxNode | null {
    const tree = syntaxTree(view.state);
    let match: SyntaxNode | null = null;

    tree.iterate({
        enter(node) {
            if (node.name !== 'Blockquote') {
                return;
            }

            if (pos >= node.from && pos <= node.to && !match) {
                match = node.node;
            }
        },
    });

    return match;
}

function stripQuoteMarkers(line: string): string {
    return line.replace(/^ {0,3}(?:> ?)+/, '');
}

function trimBlankEdgeLines(lines: string[]): string[] {
    let from = 0;
    let to = lines.length;

    while (from < to && lines[from].trim() === '') {
        from++;
    }

    while (to > from && lines[to - 1].trim() === '') {
        to--;
    }

    return lines.slice(from, to);
}

function normalizeQuoteText(source: string): string {
    const lines = source.split(/\r?\n/).map(stripQuoteMarkers);
    return trimBlankEdgeLines(lines).join('\n');
}

export function getQuoteAtPosition(view: EditorView, pos: number): ExtractedQuote | null {
    const quoteNode = findOutermostBlockquoteAtPosition(view, pos);
    if (!quoteNode) {
        return null;
    }

    const source = view.state.doc.sliceString(quoteNode.from, quoteNode.to);
    const text = normalizeQuoteText(source);
    if (!text) {
        return null;
    }

    return {
        text,
        from: quoteNode.from,
        to: quoteNode.to,
    };
}
