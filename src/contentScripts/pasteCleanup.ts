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
 * Returns the marker token a pasted sibling item converts to, or undefined to stop converting.
 * Bullet task items are not converted to ordered items, because Joplin's viewer does not render
 * ordered task lists.
 */
function getConvertedToken(target: ListItem, item: ListItem, number: number): string | undefined {
    if (!target.ordered) {
        return target.delimiter;
    }
    if (!item.ordered && item.hasTaskBox) {
        return undefined;
    }
    return `${number}${target.delimiter}`;
}

type PastedLine = {
    from: number;
    text: string;
    /** Characters of leading whitespace */
    whitespaceLength: number;
    /** Indentation width in columns */
    indent: number;
};

/**
 * Returns the non-blank lines after the first line of a paste spanning `pasteFrom` to `pasteEnd`.
 * A line starting at `pasteEnd` is document text after a paste ending in a newline, so it is excluded.
 */
function getLaterPastedLines(doc: Text, pasteFrom: number, pasteEnd: number, tabSize: number): PastedLine[] {
    const lines: PastedLine[] = [];
    for (let lineNumber = doc.lineAt(pasteFrom).number + 1; lineNumber <= doc.lines; lineNumber++) {
        const line = doc.line(lineNumber);
        if (line.from >= pasteEnd) {
            break;
        }
        const whitespaceLength = line.text.search(/[^ \t]/);
        if (whitespaceLength !== -1) {
            lines.push({
                from: line.from,
                text: line.text,
                whitespaceLength,
                indent: countColumn(line.text, tabSize, whitespaceLength),
            });
        }
    }
    return lines;
}

/**
 * Returns an edit replacing a line's leading whitespace with `indent`, and its marker token with
 * `token` when it differs from `item`'s. Unchanged markers are left out of the edit.
 *
 * @returns A single-element array with the edit, or an empty array if nothing changes
 */
function getLineStartChange(line: PastedLine, indent: string, item?: ListItem, token?: string): ChangeSpec[] {
    const replacesToken = item !== undefined && token !== undefined && token !== item.token;
    const end = replacesToken ? item.indent.length + item.token.length : line.whitespaceLength;
    const insert = replacesToken ? indent + token : indent;
    return insert === line.text.slice(0, end) ? [] : [{ from: line.from, to: line.from + end, insert }];
}

/**
 * Computes changes that fit the pasted lines after the first into the target list item:
 *
 * - Every later non-blank pasted line is shifted by the target line's indentation minus the pasted
 *   first line's original indentation (clamped at zero), written via `formatIndent`.
 * - Pasted sibling items (at the pasted first item's level) take the target's list type: its bullet
 *   character, or sequential numbers with its delimiter. Conversion stops at the first sibling-level
 *   line that is not a list item, at a less indented line, and at a bullet task item when the target
 *   is ordered (left as is). Nested children keep their own type.
 * - When a marker changes width (`- ` to `1. `, `9.` to `10.`), the item's children and continuation
 *   lines shift by the same amount so they stay nested.
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
 * @returns Indentation and marker replacements in `doc` coordinates
 *
 * @example
 * // target '   1. ', pasted '- a\n  - child\n- b'
 * // -> '   1. a\n      - child\n   2. b'
 */
export function getPastedLineChanges(
    doc: Text,
    pasteFrom: number,
    pastedText: string,
    linePrefix: string,
    tabSize: number,
    formatIndent: (columns: number) => string
): ChangeSpec[] {
    const target = parseListItem(linePrefix);
    const pastedFirst = parseListItem(pastedText);
    if (!target || !pastedFirst) {
        return [];
    }

    const targetIndent = countColumn(target.indent, tabSize);
    const baseIndent = countColumn(pastedFirst.indent, tabSize);
    const siblingLimit = countColumn(pastedText, tabSize, pastedFirst.contentStart);
    const indentDelta = targetIndent - baseIndent;

    const lines = getLaterPastedLines(doc, pasteFrom, pasteFrom + pastedText.length, tabSize);
    if (baseIndent === 0 && lines.every((line) => line.indent > 0)) {
        return [];
    }

    const changes: ChangeSpec[] = [];
    // The first pasted item's marker was replaced by the target's, so its children shift by the
    // difference in content column (e.g. '- ' -> '1. ' is +1).
    let childShift = countColumn(linePrefix, tabSize, target.contentStart) - targetIndent - (siblingLimit - baseIndent);
    let converting = true;
    let nextNumber = target.ordered ? parseInt(target.token, 10) + 1 : 0;

    for (const line of lines) {
        const indentBy = (extra: number): string => formatIndent(Math.max(0, line.indent + indentDelta + extra));

        if (line.indent >= siblingLimit) {
            changes.push(...getLineStartChange(line, indentBy(childShift)));
            continue;
        }

        const item = converting && line.indent >= baseIndent ? parseListItem(line.text) : null;
        const token = item ? getConvertedToken(target, item, nextNumber) : undefined;
        if (!item || token === undefined) {
            converting = false;
            childShift = 0;
            changes.push(...getLineStartChange(line, indentBy(0)));
            continue;
        }

        nextNumber++;
        childShift = token.length - item.token.length;
        changes.push(...getLineStartChange(line, indentBy(0), item, token));
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
 * Later pasted lines are re-indented to the target line's level and pasted sibling items take the
 * target's list type; when the paste lands on an ordered list item, the following items are renumbered.
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
    const lineChanges = getPastedLineChanges(newDoc, from, text, linePrefix, startState.tabSize, (columns) =>
        indentString(startState, columns)
    );
    if (lineChanges.length > 0) {
        logger.debug(`Re-indented or converted ${lineChanges.length} pasted line(s)`);
    }

    // The marker deletion is on the first pasted line and the line changes at the start of later
    // lines, so they never overlap and share post-paste coordinates.
    const cleanupChanges = ChangeSet.of([{ from, to: from + removedLength }, ...lineChanges], newDoc.length);
    const cleanedDoc = cleanupChanges.apply(newDoc);

    // Renumber against the cleaned document so re-indented and converted pasted items count as siblings.
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
