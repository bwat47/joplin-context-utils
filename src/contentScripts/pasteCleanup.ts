import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import type { Extension, TransactionSpec } from '@codemirror/state';
import { logger } from '../logger';

/**
 * Matches a line prefix consisting only of indentation, a list marker and an optional task box.
 *
 * @example
 * '- '        // matches
 * '  1. '     // matches
 * '- [ ] '    // matches (group 1 = '[ ] ')
 * '- foo '    // no match (text after the marker)
 */
const LIST_PREFIX_ONLY_REGEX = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(\[[ xX]\][ \t]+)?$/;

/**
 * Matches a leading list marker at the start of pasted text. Uses `[ \t]` rather than `\s`
 * so it never consumes a newline.
 *
 * @example
 * '- foo'      // strips '- '
 * '1) foo'     // strips '1) '
 * '- [ ] foo'  // strips '- ' (task box kept)
 */
const LEADING_LIST_MARKER_REGEX = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/;

/**
 * Matches a leading list marker followed by a task box at the start of pasted text.
 *
 * @example
 * '- [x] foo'  // strips '- [x] '
 * '- foo'      // strips '- '
 */
const LEADING_LIST_MARKER_AND_TASK_REGEX = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/;

const CODE_NODE_NAMES = new Set(['FencedCode', 'CodeBlock', 'InlineCode']);

/**
 * Removes a duplicate list marker from the start of pasted text when the paste lands
 * directly after an existing list marker.
 *
 * - If the line prefix has a task box (`- [ ] `), the pasted marker and task box are both removed.
 * - Otherwise only the pasted marker is removed, so a pasted task box is kept.
 * - Only the first line of the pasted text is affected.
 *
 * @param linePrefix - Line text from the line start up to the paste position
 * @param pastedText - Text being pasted
 * @returns Pasted text with the duplicate marker removed, or unchanged if not applicable
 *
 * @example
 * stripDuplicateListMarker('- ', '- [ ] foo')     // '[ ] foo'
 * stripDuplicateListMarker('- [ ] ', '- [x] foo') // 'foo'
 * stripDuplicateListMarker('- foo ', '- bar')     // '- bar'
 */
export function stripDuplicateListMarker(linePrefix: string, pastedText: string): string {
    const prefixMatch = LIST_PREFIX_ONLY_REGEX.exec(linePrefix);
    if (!prefixMatch) {
        return pastedText;
    }

    const hasTaskBox = prefixMatch[1] !== undefined;
    const markerRegex = hasTaskBox ? LEADING_LIST_MARKER_AND_TASK_REGEX : LEADING_LIST_MARKER_REGEX;
    return pastedText.replace(markerRegex, '');
}

/**
 * Checks via the syntax tree that the position is inside a list item and not inside code.
 */
function isInListItem(state: EditorState, pos: number): boolean {
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
        if (CODE_NODE_NAMES.has(node.name)) {
            return false;
        }
        if (node.name === 'ListItem') {
            return true;
        }
    }
    return false;
}

/**
 * Cleans text pasted at `from` in the given (pre-paste) editor state. Only applies to
 * single-range pastes positioned directly after a list marker inside a markdown list item.
 */
function cleanPastedText(text: string, state: EditorState, from: number): string {
    if (state.selection.ranges.length !== 1) {
        return text;
    }

    const line = state.doc.lineAt(from);
    const linePrefix = line.text.slice(0, from - line.from);

    if (!LIST_PREFIX_ONLY_REGEX.test(linePrefix) || !isInListItem(state, from)) {
        return text;
    }

    const cleaned = stripDuplicateListMarker(linePrefix, text);
    if (cleaned !== text) {
        logger.debug('Removed duplicate list marker from pasted text');
    }
    return cleaned;
}

/**
 * Rewrites a single-change `input.paste` transaction with cleaned text, or returns it unchanged.
 */
function cleanPasteTransaction(tr: Transaction): Transaction | TransactionSpec {
    if (!tr.docChanged || !tr.isUserEvent('input.paste')) {
        return tr;
    }

    const changes: Array<{ from: number; to: number; text: string }> = [];
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        changes.push({ from: fromA, to: toA, text: inserted.toString() });
    });
    if (changes.length !== 1) {
        return tr;
    }

    const { from, to, text } = changes[0];
    const cleaned = cleanPastedText(text, tr.startState, from);
    if (cleaned === text) {
        return tr;
    }

    return {
        changes: { from, to, insert: cleaned },
        selection: EditorSelection.cursor(from + cleaned.length),
        effects: tr.effects,
        scrollIntoView: tr.scrollIntoView,
        annotations: Transaction.userEvent.of(tr.annotation(Transaction.userEvent) ?? 'input.paste'),
    };
}

/**
 * Creates a CodeMirror extension that removes duplicate list markers from pasted text.
 *
 * Uses a transaction filter on `input.paste` rather than `EditorView.clipboardInputFilter`,
 * because Joplin desktop's Paste command reads the clipboard itself and inserts via
 * `replaceSelection` with `userEvent: 'input.paste'`, bypassing CodeMirror's paste handler.
 * CodeMirror's native paste uses the same user event, so both paths are covered.
 *
 * @param isEnabled - Read on every paste so the setting can change without reconfiguring the editor
 */
export function createPasteCleanupExtension(isEnabled: () => boolean): Extension {
    return EditorState.transactionFilter.of((tr) => (isEnabled() ? cleanPasteTransaction(tr) : tr));
}
