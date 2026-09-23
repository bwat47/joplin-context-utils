import { indentString, language, syntaxTree } from '@codemirror/language';
import type { Parser, SyntaxNode, Tree } from '@lezer/common';
import { ChangeSet, EditorState, Text, Transaction, countColumn } from '@codemirror/state';
import type { ChangeSpec, Extension, TransactionSpec } from '@codemirror/state';
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
const LIST_NODE_NAMES = new Set(['BulletList', 'OrderedList']);

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

/** Whether a line belongs to the preceding list item's Markdown syntax node. */
function isContinuationOfItem(tree: Tree, doc: Text, pos: number, itemLineNumber: number): boolean {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, 1); node; node = node.parent) {
        if (node.name === 'ListItem') {
            return doc.lineAt(node.from).number === itemLineNumber;
        }
    }
    return false;
}

/**
 * Computes changes that renumber the ordered list items following a list item line, continuing
 * from that item's number. Walks sibling items at the item's indentation, skipping blank lines and
 * more deeply indented lines (children, continuation lines). Before stopping at a non-matching line,
 * checks the Markdown tree: a lazy paragraph continuation can be unindented while
 * still belonging to the preceding item. Existing numbers are replaced unconditionally, so
 * `1. 1. 1.` style lists become sequential.
 *
 * @param doc - Document to renumber (the post-paste document)
 * @param firstLineNumber - Line number of the list item to continue numbering from
 * @param linePrefix - That line's text up to the paste position, e.g. `'3. '`
 * @param tabSize - Tab size for measuring indentation
 * @param parser - The editor's Markdown parser, when available, to identify lazy continuations
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
    tabSize: number,
    parser?: Parser
): ChangeSpec[] {
    const target = parseListItem(linePrefix);
    if (!target?.ordered || target.length !== linePrefix.length) {
        return [];
    }

    const markerIndent = countColumn(target.indent, tabSize);
    const contentIndent = countColumn(linePrefix, tabSize, target.contentStart);
    let nextNumber = parseInt(target.token, 10) + 1;
    let previousItemLineNumber = firstLineNumber;
    const changes: ChangeSpec[] = [];
    let tree: Tree | undefined;

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
        const item = parseListItem(line.text);
        if (lineIndent < markerIndent || !item?.ordered || item.delimiter !== target.delimiter) {
            tree ??= parser?.parse(doc.toString());
            if (tree && isContinuationOfItem(tree, doc, line.from + leadingWhitespaceLength, previousItemLineNumber)) {
                continue;
            }
            break;
        }

        const insert = `${nextNumber++}${target.delimiter}`;
        previousItemLineNumber = lineNumber;
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
 * Returns the lines after the first line of a paste spanning `pasteFrom` to `pasteEnd`, with null
 * for blank lines so index `i` is pasted line `i + 1`. A line starting at `pasteEnd` is document
 * text after a paste ending in a newline, so it is excluded.
 */
function getLaterPastedLines(
    doc: Text,
    pasteFrom: number,
    pasteEnd: number,
    tabSize: number
): Array<PastedLine | null> {
    const lines: Array<PastedLine | null> = [];
    for (let lineNumber = doc.lineAt(pasteFrom).number + 1; lineNumber <= doc.lines; lineNumber++) {
        const line = doc.line(lineNumber);
        if (line.from >= pasteEnd) {
            break;
        }
        const whitespaceLength = line.text.search(/[^ \t]/);
        lines.push(
            whitespaceLength === -1
                ? null
                : {
                      from: line.from,
                      text: line.text,
                      whitespaceLength,
                      indent: countColumn(line.text, tabSize, whitespaceLength),
                  }
        );
    }
    return lines;
}

/**
 * Returns an edit setting a line's indentation to `columns` (clamped at zero), and its marker token
 * to `token` when it differs from `item`'s. The line's existing whitespace is kept when its width is
 * unchanged, so only moved lines take the editor's indent style via `formatIndent`.
 *
 * @returns A single-element array with the edit, or an empty array if nothing changes
 */
function getLineStartChange(
    line: PastedLine,
    columns: number,
    formatIndent: (columns: number) => string,
    item?: ListItem,
    token?: string
): ChangeSpec[] {
    const newColumns = Math.max(0, columns);
    const indent = newColumns === line.indent ? line.text.slice(0, line.whitespaceLength) : formatIndent(newColumns);
    const replacesToken = item !== undefined && token !== undefined && token !== item.token;
    const end = replacesToken ? item.indent.length + item.token.length : line.whitespaceLength;
    const insert = replacesToken ? indent + token : indent;
    return insert === line.text.slice(0, end) ? [] : [{ from: line.from, to: line.from + end, insert }];
}

/** A top-level pasted list item, from parsing the pasted text. */
type PastedItem = {
    /** Pasted line index of the item's marker line (0 is the pasted first line) */
    startLine: number;
    /** Pasted line index of the item's last line */
    endLine: number;
    /**
     * Original columns of the item's direct child blocks after its marker line, and of each item in
     * a direct child list. Excludes indented code blocks.
     */
    childColumns: number[];
    /** Whether the item directly contains an indented code block */
    hasCodeBlock: boolean;
};

/**
 * Describes a parsed top-level `ListItem` node: its line span and the columns of its direct children.
 *
 * @param lineIndexAt - Maps a parsed position to its pasted line index
 * @param columnOf - Maps a pasted line index to the line's original indentation in columns
 */
function describeItem(
    node: SyntaxNode,
    lineIndexAt: (pos: number) => number,
    columnOf: (lineIndex: number) => number
): PastedItem {
    const startLine = lineIndexAt(node.from);
    const item: PastedItem = { startLine, endLine: lineIndexAt(node.to), childColumns: [], hasCodeBlock: false };
    for (let child = node.firstChild; child; child = child.nextSibling) {
        const childLine = lineIndexAt(child.from);
        if (childLine === startLine) {
            continue;
        }
        if (child.name === 'CodeBlock') {
            item.hasCodeBlock = true;
        } else if (LIST_NODE_NAMES.has(child.name)) {
            for (let nested = child.firstChild; nested; nested = nested.nextSibling) {
                item.childColumns.push(columnOf(lineIndexAt(nested.from)));
            }
        } else {
            item.childColumns.push(columnOf(childLine));
        }
    }
    return item;
}

/**
 * Parses the pasted text and returns the items of the lists it starts with: the list holding the
 * pasted first item and any lists directly after it (CommonMark starts a new list when the bullet
 * character or ordered delimiter changes). Stops at the first top-level block that is not a list.
 *
 * Only `scopeLines` lines are parsed, with `baseIndent` columns of indentation removed from each,
 * so items copied along with their nesting indentation still parse as a list rather than as code.
 *
 * @param firstLine - Pasted first line, starting at its list marker's indentation
 * @param lines - Later pasted lines, as from `getLaterPastedLines`
 * @param scopeLines - Number of pasted lines to parse, counting the first line
 * @param baseIndent - Pasted first line's indentation in columns
 * @param parser - The editor's Markdown parser
 *
 * @example
 * // pasted '- a\n\n      code\n\n  para\n   - b\n* c'
 * // -> [{ startLine: 0, endLine: 5, childColumns: [2, 3], hasCodeBlock: true },
 * //     { startLine: 6, endLine: 6, childColumns: [], hasCodeBlock: false }]
 */
function getPastedItems(
    firstLine: string,
    lines: Array<PastedLine | null>,
    scopeLines: number,
    baseIndent: number,
    parser: Parser
): PastedItem[] {
    const scoped = lines.slice(0, scopeLines - 1);
    const text = Text.of([
        firstLine.trimStart(),
        ...scoped.map((line) =>
            line ? ' '.repeat(line.indent - baseIndent) + line.text.slice(line.whitespaceLength) : ''
        ),
    ]);
    const lineIndexAt = (pos: number): number => text.lineAt(pos).number - 1;
    const columnOf = (lineIndex: number): number => scoped[lineIndex - 1]?.indent ?? baseIndent;

    const items: PastedItem[] = [];
    const tree = parser.parse(text.toString());
    for (let list = tree.topNode.firstChild; list && LIST_NODE_NAMES.has(list.name); list = list.nextSibling) {
        for (let node = list.firstChild; node; node = node.nextSibling) {
            items.push(describeItem(node, lineIndexAt, columnOf));
        }
    }
    return items;
}

/** Where a pasted item's content lands after the paste changes. */
type ItemPlacement = {
    /** The item's content column after the paste changes */
    contentColumn: number;
    /** Columns the content column moved by, beyond `indentDelta` */
    contentShift: number;
};

/**
 * Most columns a nested list item may sit past its parent's content column; any further and
 * CommonMark parses it as an indented code block.
 */
const MAX_CHILD_OFFSET = 3;

/**
 * Returns the extra shift that keeps an item's children nested after its marker changed width.
 *
 * - An item that directly contains an indented code block moves its children by exactly its content
 *   column change, since the code block's meaning depends on its exact offset from the content column.
 * - Otherwise the children move the minimum amount that keeps every child block and child list
 *   item within the valid range (content column to `MAX_CHILD_OFFSET` past it). An item whose only
 *   children are continuation lines keeps the least indented one in range instead.
 *
 * @param item - The parsed item
 * @param placement - Where the item's content lands after the paste changes
 * @param childIndents - Indentation of the item's non-blank lines after its marker line
 * @param indentDelta - Columns every later pasted line shifts by
 *
 * @example
 * // '- a\n  - child' -> '1. a': child at 2, content column 3 -> shift +1
 * // '- a\n    - child' -> '1. a': child at 4, within 3..6 -> no shift
 * // '- a\n\n      code' -> '1. a': direct code block -> shift +1
 * // '10. a\n    para\n\n       - item' -> '- a': item at 7 past 2..5 -> shift -2
 */
function getChildShift(
    item: PastedItem,
    { contentColumn, contentShift }: ItemPlacement,
    childIndents: number[],
    indentDelta: number
): number {
    if (childIndents.length === 0) {
        return 0;
    }
    if (item.hasCodeBlock) {
        return contentShift;
    }

    const columns = item.childColumns.length > 0 ? item.childColumns : [Math.min(...childIndents)];
    const lowest = Math.min(...columns) + indentDelta;
    const highest = Math.max(...columns) + indentDelta;
    return Math.min(Math.max(0, contentColumn - lowest), contentColumn + MAX_CHILD_OFFSET - highest);
}

/** The edit planned for a later pasted line, applied on top of the shared `indentDelta`. */
type LinePlan = {
    /** Extra columns to shift by */
    shift: number;
    /** The line's list item marker and the token it converts to */
    item?: ListItem;
    token?: string;
};

/**
 * Converts a later pasted item's marker to the target's list type.
 *
 * @returns The marker line's plan and the item's placement, or null to stop converting
 */
function convertItemMarker(
    line: PastedLine | null,
    target: ListItem,
    number: number,
    indentDelta: number,
    tabSize: number
): (ItemPlacement & { plan: LinePlan }) | null {
    const item = line && parseListItem(line.text);
    const token = item ? getConvertedToken(target, item, number) : undefined;
    if (!line || !item || token === undefined) {
        return null;
    }

    const contentShift = token.length - item.token.length;
    const contentColumn = countColumn(line.text, tabSize, item.contentStart) + indentDelta + contentShift;
    return { plan: { shift: 0, item, token }, contentColumn, contentShift };
}

/**
 * Computes changes that fit the pasted lines after the first into the target list item:
 *
 * - Every later non-blank pasted line is shifted by the target line's indentation minus the pasted
 *   first line's original indentation (clamped at zero). Lines whose indentation width is unchanged
 *   keep their whitespace; moved lines are written via `formatIndent`.
 * - The pasted text is parsed with the editor's Markdown parser. Items of the list holding the pasted
 *   first item, and of lists directly after it, take the target's list type: its bullet character, or
 *   sequential numbers with its delimiter. Conversion stops where the lists end, at a pasted line less
 *   indented than the first, and at a bullet task item when the target is ordered (left as is).
 *   Nested children keep their own type.
 * - When a marker changes width (`- ` to `1. `, `9.` to `10.`) and the item's children would no
 *   longer be nested under it, the children shift the minimum amount to keep every child block
 *   nested. Items that directly contain an indented code block shift their children by the full
 *   content column change.
 *
 * The pasted first line's indentation is taken as its original level. A copy that started at a
 * nested item's marker lost that indentation, so its later sibling items nest under the first.
 *
 * @param doc - Post-paste document
 * @param pasteFrom - Position where the paste was inserted
 * @param pastedText - Original pasted text, as inserted at `pasteFrom`
 * @param linePrefix - Target line's text up to the paste position, e.g. `'   1. '`
 * @param tabSize - Tab size for measuring indentation
 * @param formatIndent - Builds the whitespace for an indentation width in columns
 * @param parser - The editor's Markdown parser
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
    formatIndent: (columns: number) => string,
    parser: Parser
): ChangeSpec[] {
    const target = parseListItem(linePrefix);
    const pastedFirst = parseListItem(pastedText);
    if (!target || !pastedFirst) {
        return [];
    }

    const baseIndent = countColumn(pastedFirst.indent, tabSize);
    const indentDelta = countColumn(target.indent, tabSize) - baseIndent;
    const lines = getLaterPastedLines(doc, pasteFrom, pasteFrom + pastedText.length, tabSize);

    const lessIndented = lines.findIndex((line) => line !== null && line.indent < baseIndent);
    const scopeLines = lessIndented === -1 ? lines.length + 1 : lessIndented + 1;
    const [firstLine] = pastedText.split('\n', 1);
    const items = getPastedItems(firstLine, lines, scopeLines, baseIndent, parser);

    const plans: LinePlan[] = lines.map(() => ({ shift: 0 }));
    const firstContentColumn = countColumn(linePrefix, tabSize, target.contentStart);
    const firstPlacement: ItemPlacement = {
        contentColumn: firstContentColumn,
        contentShift: firstContentColumn - countColumn(pastedText, tabSize, pastedFirst.contentStart) - indentDelta,
    };
    let nextNumber = target.ordered ? parseInt(target.token, 10) + 1 : 0;
    for (const item of items) {
        let placement = firstPlacement;
        if (item.startLine > 0) {
            const converted = convertItemMarker(lines[item.startLine - 1], target, nextNumber++, indentDelta, tabSize);
            if (!converted) {
                break;
            }
            plans[item.startLine - 1] = converted.plan;
            placement = converted;
        }

        const childIndents = lines
            .slice(item.startLine, item.endLine)
            .filter((line) => line !== null)
            .map((line) => line.indent);
        const childShift = getChildShift(item, placement, childIndents, indentDelta);
        for (let index = item.startLine; index < item.endLine; index++) {
            plans[index].shift = childShift;
        }
    }

    return lines.flatMap((line, index) => {
        if (!line) {
            return [];
        }
        const { shift, item, token } = plans[index];
        return getLineStartChange(line, line.indent + indentDelta + shift, formatIndent, item, token);
    });
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
    const target = parseListItem(linePrefix);
    const pastedFirst = parseListItem(text);
    const keepBulletTask = target?.ordered && pastedFirst !== null && !pastedFirst.ordered && pastedFirst.hasTaskBox;
    const effectivePrefix = keepBulletTask
        ? linePrefix.slice(0, target.indent.length) +
          pastedFirst.token +
          linePrefix.slice(target.indent.length + target.token.length)
        : linePrefix;
    const removedLength = text.length - cleaned.length;
    const markdownLanguage = startState.facet(language);
    const lineChanges = markdownLanguage
        ? getPastedLineChanges(
              newDoc,
              from,
              text,
              effectivePrefix,
              startState.tabSize,
              (columns) => indentString(startState, columns),
              markdownLanguage.parser
          )
        : [];
    if (lineChanges.length > 0) {
        logger.debug(`Re-indented or converted ${lineChanges.length} pasted line(s)`);
    }

    // The target marker, pasted marker, and later line edits do not overlap and share
    // post-paste coordinates.
    const targetMarkerChange: ChangeSpec[] = keepBulletTask
        ? [
              {
                  from: from - linePrefix.length + target.indent.length,
                  to: from - linePrefix.length + target.indent.length + target.token.length,
                  insert: pastedFirst.token,
              },
          ]
        : [];
    const cleanupChanges = ChangeSet.of(
        [...targetMarkerChange, { from, to: from + removedLength }, ...lineChanges],
        newDoc.length
    );
    const cleanedDoc = cleanupChanges.apply(newDoc);

    // Renumber against the cleaned document so re-indented and converted pasted items count as siblings.
    const renumberChanges = getListRenumberChanges(
        cleanedDoc,
        startState.doc.lineAt(from).number,
        effectivePrefix,
        startState.tabSize,
        markdownLanguage?.parser
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
