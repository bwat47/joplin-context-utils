import { indentString, syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { ChangeSet, EditorState, Transaction, countColumn } from '@codemirror/state';
import type { ChangeSpec, Extension, Text, TransactionSpec } from '@codemirror/state';
import { logger } from '../logger';

/**
 * Indentation plus a bullet (`-`, `*`, `+`) or ordered (`1.`, `1)`) marker and its trailing
 * whitespace. Uses `[ \t]` rather than `\s` so it never consumes a newline.
 */
const LIST_MARKER_SOURCE = String.raw`[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+`;

/** A task box (`[ ]`, `[x]`, `[X]`) and its trailing whitespace. */
const TASK_BOX_SOURCE = String.raw`\[[ xX]\][ \t]+`;

/**
 * Matches a line prefix consisting only of indentation, a list marker and an optional task box.
 *
 * @example
 * '- '        // matches
 * '  1. '     // matches
 * '- [ ] '    // matches (group 1 = '[ ] ')
 * '- foo '    // no match (text after the marker)
 */
const LIST_PREFIX_ONLY_REGEX = new RegExp(`^${LIST_MARKER_SOURCE}(${TASK_BOX_SOURCE})?$`);

/**
 * Matches a leading list marker at the start of pasted text.
 *
 * @example
 * '- foo'      // strips '- '
 * '1) foo'     // strips '1) '
 * '- [ ] foo'  // strips '- ' (task box kept)
 */
const LEADING_LIST_MARKER_REGEX = new RegExp(`^${LIST_MARKER_SOURCE}`);

/**
 * Matches a leading list marker followed by a task box at the start of pasted text.
 *
 * @example
 * '- [x] foo'  // strips '- [x] '
 * '- foo'      // strips '- '
 */
const LEADING_LIST_MARKER_AND_TASK_REGEX = new RegExp(`^${LIST_MARKER_SOURCE}(?:${TASK_BOX_SOURCE})?`);

/**
 * Matches the list item marker at the start of a line: indentation, a bullet or ordered marker,
 * its trailing whitespace (or the line end), and an optional task box.
 * Group 1 = indentation, 2 = marker token, 3 = trailing whitespace, 4 = task box.
 *
 * @example
 * '- foo'        // token '-'
 * '  12) bar'    // indentation '  ', token '12)'
 * '1. [x] done'  // token '1.', task box '[x] '
 * '5.'           // token '5.' (empty item)
 * '5.5 apples'   // no match
 * '-foo'         // no match
 */
const LIST_ITEM_REGEX = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)(\[[ xX]\](?:[ \t]+|$))?/;

/** A list item marker parsed from the start of a line. */
type ListItem = {
    /** Leading whitespace */
    indent: string;
    /** Marker token: `-`, `*`, `+`, or a number with its delimiter such as `12.` or `3)` */
    token: string;
    ordered: boolean;
    /** Last character of the token: the bullet character, or `.` / `)` for ordered markers */
    delimiter: string;
    /** Characters from the line start to the item content, excluding any task box */
    contentStart: number;
    hasTaskBox: boolean;
    /** Characters matched, including any task box */
    length: number;
};

/**
 * Parses the list item marker at the start of `text`.
 *
 * @returns The parsed marker, or null if `text` does not start with a list item
 */
export function parseListItem(text: string): ListItem | null {
    const match = LIST_ITEM_REGEX.exec(text);
    if (!match) {
        return null;
    }

    const [matched, indent, token, trailingWhitespace, taskBox] = match;
    return {
        indent,
        token,
        ordered: /\d/.test(token),
        delimiter: token.slice(-1),
        contentStart: indent.length + token.length + trailingWhitespace.length,
        hasTaskBox: taskBox !== undefined,
        length: matched.length,
    };
}

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
 * Computes changes that renumber the ordered list items following a list item line, continuing
 * from that item's number. Walks sibling items at the item's indentation, skipping blank lines and
 * more deeply indented lines (children, continuation lines), and stops at the first line that ends
 * the list: less indented text, or sibling-level text that is not an ordered marker with the same
 * delimiter. Existing numbers are replaced unconditionally, so `1. 1. 1.` style lists become sequential.
 *
 * @param doc - Document to renumber (the post-paste document)
 * @param firstLineNumber - Line number of the list item to continue numbering from
 * @param linePrefix - That line's text up to the paste position, e.g. `'3. '`
 * @param tabSize - Tab size for measuring indentation
 * @returns Number replacements in `doc` coordinates; empty if the prefix is not an ordered marker
 *
 * @example
 * // doc: '2. a\n1. b\n   1. child\n1. c', prefix '2. '
 * // -> '2. a\n3. b\n   1. child\n4. c'
 */
export function getListRenumberChanges(
    doc: Text,
    firstLineNumber: number,
    linePrefix: string,
    tabSize: number
): ChangeSpec[] {
    const target = parseListItem(linePrefix);
    if (!target?.ordered || target.length !== linePrefix.length) {
        return [];
    }

    const markerIndent = countColumn(target.indent, tabSize);
    const contentIndent = countColumn(linePrefix, tabSize, target.contentStart);
    let nextNumber = parseInt(target.token, 10) + 1;
    const changes: ChangeSpec[] = [];

    for (let lineNumber = firstLineNumber + 1; lineNumber <= doc.lines; lineNumber++) {
        const line = doc.line(lineNumber);
        const leadingWhitespaceLength = line.text.search(/[^ \t]/);
        if (leadingWhitespaceLength === -1) {
            continue;
        }

        const lineIndent = countColumn(line.text, tabSize, leadingWhitespaceLength);
        if (lineIndent >= contentIndent) {
            continue;
        }
        if (lineIndent < markerIndent) {
            break;
        }

        const item = parseListItem(line.text);
        if (!item?.ordered || item.delimiter !== target.delimiter) {
            break;
        }

        const insert = `${nextNumber++}${target.delimiter}`;
        if (item.token !== insert) {
            const tokenFrom = line.from + item.indent.length;
            changes.push({ from: tokenFrom, to: tokenFrom + item.token.length, insert });
        }
    }

    return changes;
}

/**
 * Returns the indentation width in columns of the first line of `text`.
 */
function leadingIndentColumns(text: string, tabSize: number): number {
    const whitespaceLength = /^[ \t]*/.exec(text)?.[0].length ?? 0;
    return countColumn(text, tabSize, whitespaceLength);
}

/**
 * Computes changes that shift the pasted lines after the first so the pasted list keeps its
 * structure at the target line's indentation. The shift is the target line's indentation minus
 * the pasted first line's original indentation, applied to every later non-blank pasted line
 * (clamped at zero) and written with the editor's indent unit via `formatIndent`.
 *
 * When the pasted first line has no indentation but every later non-blank line is indented, the
 * copy may have started at the marker and dropped the first line's indentation, so the original
 * level is unknown and no changes are made.
 *
 * @param doc - Post-paste document
 * @param pasteFrom - Position where the paste was inserted
 * @param pastedText - Original pasted text, as inserted at `pasteFrom`
 * @param linePrefix - Target line's text up to the paste position, e.g. `'   1. '`
 * @param tabSize - Tab size for measuring indentation
 * @param formatIndent - Builds the whitespace for an indentation width in columns
 * @returns Indentation replacements in `doc` coordinates
 *
 * @example
 * // target '   - ', pasted '- a\n  - child\n- b'
 * // -> '   - a\n     - child\n   - b'
 */
export function getPasteReindentChanges(
    doc: Text,
    pasteFrom: number,
    pastedText: string,
    linePrefix: string,
    tabSize: number,
    formatIndent: (columns: number) => string
): ChangeSpec[] {
    const baseIndent = leadingIndentColumns(pastedText, tabSize);
    const indentDelta = leadingIndentColumns(linePrefix, tabSize) - baseIndent;
    if (indentDelta === 0) {
        return [];
    }

    const pasteEnd = pasteFrom + pastedText.length;
    const lines: Array<{ from: number; whitespace: string; indent: number }> = [];
    for (let lineNumber = doc.lineAt(pasteFrom).number + 1; lineNumber <= doc.lines; lineNumber++) {
        const line = doc.line(lineNumber);
        if (line.from >= pasteEnd) {
            break;
        }
        const whitespaceLength = line.text.search(/[^ \t]/);
        if (whitespaceLength === -1) {
            continue;
        }
        lines.push({
            from: line.from,
            whitespace: line.text.slice(0, whitespaceLength),
            indent: countColumn(line.text, tabSize, whitespaceLength),
        });
    }

    if (baseIndent === 0 && lines.every((line) => line.indent > 0)) {
        return [];
    }

    const changes: ChangeSpec[] = [];
    for (const line of lines) {
        const insert = formatIndent(Math.max(0, line.indent + indentDelta));
        if (insert !== line.whitespace) {
            changes.push({ from: line.from, to: line.from + line.whitespace.length, insert });
        }
    }
    return changes;
}

/**
 * Returns the line text from the line start up to `pos`.
 */
function getLinePrefix(state: EditorState, pos: number): string {
    const line = state.doc.lineAt(pos);
    return line.text.slice(0, pos - line.from);
}

/**
 * Checks via the syntax tree whether the position is inside code.
 *
 * A list item is intentionally not required: an empty marker line directly after a paragraph
 * (`Some text\n- `) parses as a setext heading underline or paragraph continuation, not a list.
 */
function isInCode(state: EditorState, pos: number): boolean {
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
        if (CODE_NODE_NAMES.has(node.name)) {
            return true;
        }
    }
    return false;
}

/**
 * Cleans text pasted at `from` in the given (pre-paste) editor state. Only applies to
 * single-range pastes positioned directly after a list marker, outside code.
 */
function cleanPastedText(text: string, state: EditorState, from: number): string {
    if (state.selection.ranges.length !== 1) {
        return text;
    }

    const linePrefix = getLinePrefix(state, from);

    // Cheap prefix check first to skip the syntax tree walk; stripDuplicateListMarker re-checks
    // the prefix itself so it stays correct as a standalone pure function.
    if (!LIST_PREFIX_ONLY_REGEX.test(linePrefix) || isInCode(state, from)) {
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
 * Later pasted lines are re-indented to the target line's level, and when the paste lands on an
 * ordered list item, the following items are renumbered as well.
 */
function cleanPasteTransaction(tr: Transaction): Transaction | readonly TransactionSpec[] {
    if (!tr.docChanged || !tr.isUserEvent('input.paste')) {
        return tr;
    }

    const changes: Array<{ from: number; text: string }> = [];
    tr.changes.iterChanges((fromA, _toA, _fromB, _toB, inserted) => {
        changes.push({ from: fromA, text: inserted.toString() });
    });
    if (changes.length !== 1) {
        return tr;
    }

    const { from, text } = changes[0];
    const cleaned = cleanPastedText(text, tr.startState, from);
    if (cleaned === text) {
        return tr;
    }

    const { startState, newDoc } = tr;
    const linePrefix = getLinePrefix(startState, from);
    const removedLength = text.length - cleaned.length;
    const reindentChanges = getPasteReindentChanges(newDoc, from, text, linePrefix, startState.tabSize, (columns) =>
        indentString(startState, columns)
    );
    if (reindentChanges.length > 0) {
        logger.debug(`Re-indented ${reindentChanges.length} pasted line(s)`);
    }

    // The marker deletion is on the first pasted line and the re-indentation at the start of later
    // lines, so they never overlap and share post-paste coordinates.
    const cleanupChanges = ChangeSet.of([{ from, to: from + removedLength }, ...reindentChanges], newDoc.length);
    const cleanedDoc = cleanupChanges.apply(newDoc);

    // Renumber against the re-indented document so re-indented pasted items count as siblings.
    const renumberChanges = getListRenumberChanges(
        cleanedDoc,
        cleanedDoc.lineAt(from).number,
        linePrefix,
        startState.tabSize
    );
    if (renumberChanges.length > 0) {
        logger.debug(`Renumbered ${renumberChanges.length} ordered list item(s) after paste`);
    }

    // Compose the cleanup and renumbering after the original paste. CodeMirror maps the paste's
    // selection and effects through them while retaining every annotation on the paste.
    return [
        tr,
        { changes: cleanupChanges, sequential: true },
        ...(renumberChanges.length > 0 ? [{ changes: renumberChanges, sequential: true }] : []),
    ];
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
