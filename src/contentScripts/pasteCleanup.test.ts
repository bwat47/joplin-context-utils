import type { Extension } from '@codemirror/state';
import { Annotation, ChangeSet, EditorSelection, EditorState, StateEffect, Text, Transaction } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { indentUnit } from '@codemirror/language';
import {
    createPasteCleanupExtension,
    getListRenumberChanges,
    getPastedLineChanges,
    parseListItem,
    stripDuplicateListMarker,
} from './pasteCleanup';

describe('stripDuplicateListMarker', () => {
    it.each([
        ['- ', '- foo', 'foo'],
        ['1. ', '- foo', 'foo'],
        ['- ', '1. foo', 'foo'],
        ['- ', '1) foo', 'foo'],
        ['- ', '+ foo', 'foo'],
        ['  * ', '* foo', 'foo'],
        ['- ', '   - foo', 'foo'],
        ['- ', '\t- foo', 'foo'],
    ])('strips the pasted marker (line %j, paste %j)', (prefix, pasted, expected) => {
        expect(stripDuplicateListMarker(prefix, pasted)).toBe(expected);
    });

    it('keeps a pasted task box when the line has no task box', () => {
        expect(stripDuplicateListMarker('- ', '- [ ] foo')).toBe('[ ] foo');
        expect(stripDuplicateListMarker('- ', '- [x] foo')).toBe('[x] foo');
    });

    it('strips the pasted marker and task box when the line has a task box', () => {
        expect(stripDuplicateListMarker('- [ ] ', '- [x] foo')).toBe('foo');
        expect(stripDuplicateListMarker('- [X] ', '- [ ] foo')).toBe('foo');
        expect(stripDuplicateListMarker('- [ ] ', '- foo')).toBe('foo');
    });

    it('only affects the first line of a multi-line paste', () => {
        expect(stripDuplicateListMarker('- ', '- first\n- second')).toBe('first\n- second');
        expect(stripDuplicateListMarker('- ', '- first\r\n- second')).toBe('first\r\n- second');
    });

    it('never consumes a leading newline', () => {
        expect(stripDuplicateListMarker('- ', '\n- foo')).toBe('\n- foo');
    });

    it('leaves text unchanged when the line prefix is not only a list marker', () => {
        expect(stripDuplicateListMarker('- foo ', '- bar')).toBe('- bar');
        expect(stripDuplicateListMarker('', '- bar')).toBe('- bar');
        expect(stripDuplicateListMarker('> - ', '- bar')).toBe('- bar');
    });

    it('leaves text unchanged when the paste does not start with a list marker', () => {
        expect(stripDuplicateListMarker('- ', '**bold**')).toBe('**bold**');
        expect(stripDuplicateListMarker('- ', '-foo')).toBe('-foo');
        expect(stripDuplicateListMarker('- ', '---')).toBe('---');
    });
});

describe('parseListItem', () => {
    it.each([
        [
            '- foo',
            { indent: '', token: '-', ordered: false, delimiter: '-', contentStart: 2, hasTaskBox: false, length: 2 },
        ],
        [
            '  12) bar',
            {
                indent: '  ',
                token: '12)',
                ordered: true,
                delimiter: ')',
                contentStart: 6,
                hasTaskBox: false,
                length: 6,
            },
        ],
        [
            '1. [x] done',
            { indent: '', token: '1.', ordered: true, delimiter: '.', contentStart: 3, hasTaskBox: true, length: 7 },
        ],
        [
            '\t* [ ]',
            { indent: '\t', token: '*', ordered: false, delimiter: '*', contentStart: 3, hasTaskBox: true, length: 6 },
        ],
        [
            '5.',
            { indent: '', token: '5.', ordered: true, delimiter: '.', contentStart: 2, hasTaskBox: false, length: 2 },
        ],
    ])('parses %j', (text, expected) => {
        expect(parseListItem(text)).toEqual(expected);
    });

    it.each(['5.5 apples', '-foo', '---', 'text', '1234567890. too long'])('returns null for %j', (text) => {
        expect(parseListItem(text)).toBeNull();
    });
});

describe('getListRenumberChanges', () => {
    const renumber = (lines: string[], linePrefix: string, tabSize = 4) => {
        const doc = Text.of(lines);
        const changes = getListRenumberChanges(doc, 1, linePrefix, tabSize);
        return ChangeSet.of(changes, doc.length).apply(doc).toString();
    };

    it('continues numbering from the prefix number', () => {
        expect(renumber(['2. a', '1. b', '1. c'], '2. ')).toBe('2. a\n3. b\n4. c');
    });

    it('returns no changes for a non-ordered prefix', () => {
        const doc = Text.of(['- a', '1. b']);
        expect(getListRenumberChanges(doc, 1, '- ', 4)).toEqual([]);
        expect(getListRenumberChanges(doc, 1, '1. foo ', 4)).toEqual([]);
    });

    it('returns no changes when numbers are already sequential', () => {
        expect(getListRenumberChanges(Text.of(['1. a', '2. b']), 1, '1. ', 4)).toEqual([]);
    });

    it('measures tab indentation in columns', () => {
        expect(renumber(['\t1. a', '\t1. b', '\t\t1. child', '1. outer'], '\t1. ')).toBe(
            '\t1. a\n\t2. b\n\t\t1. child\n1. outer'
        );
    });
});

describe('createPasteCleanupExtension', () => {
    const createState = (doc: string, ranges: Array<[number, number]>, enabled = true, extensions: Extension[] = []) =>
        EditorState.create({
            doc,
            selection: EditorSelection.create(ranges.map(([anchor, head]) => EditorSelection.range(anchor, head))),
            extensions: [
                EditorState.allowMultipleSelections.of(true),
                markdown({ extensions: [GFM] }),
                createPasteCleanupExtension(() => enabled),
                ...extensions,
            ],
        });

    /** Mirrors Joplin's `insertText(text, UserEventSource.Paste)` */
    const paste = (state: EditorState, text: string, userEvent = 'input.paste') =>
        state.update(state.replaceSelection(text), { userEvent }).state;

    /** Pastes at the cursor (`|`) or over the selection (`|...|`) marked in `docWithCursor`. */
    const pasteAt = (docWithCursor: string, text: string, enabled = true, extensions: Extension[] = []) => {
        const anchor = docWithCursor.indexOf('|');
        const head = docWithCursor.indexOf('|', anchor + 1);
        const doc = docWithCursor.replace(/\|/g, '');
        const range: [number, number] = head === -1 ? [anchor, anchor] : [anchor, head - 1];
        return paste(createState(doc, [range], enabled, extensions), text);
    };

    it('strips the pasted marker on a list line', () => {
        const result = paste(createState('Intro\n\n- ', [[9, 9]]), '- foo');
        expect(result.doc.toString()).toBe('Intro\n\n- foo');
        expect(result.selection.main.head).toBe(result.doc.length);
    });

    it('preserves paste annotations and maps selection and effects through the removed marker', () => {
        const positionEffect = StateEffect.define<number>({
            map: (position, changes) => changes.mapPos(position),
        });
        const sourceAnnotation = Annotation.define<string>();
        const state = createState('- ', [[2, 2]]);
        const transaction = state.update({
            changes: { from: 2, insert: '- foo' },
            selection: EditorSelection.range(4, 7),
            effects: positionEffect.of(6),
            annotations: [
                Transaction.userEvent.of('input.paste'),
                Transaction.addToHistory.of(false),
                sourceAnnotation.of('clipboard'),
            ],
        });

        expect(transaction.newDoc.toString()).toBe('- foo');
        expect(transaction.newSelection.main.from).toBe(2);
        expect(transaction.newSelection.main.to).toBe(5);
        expect(transaction.effects.find((effect) => effect.is(positionEffect))?.value).toBe(4);
        expect(transaction.annotation(Transaction.addToHistory)).toBe(false);
        expect(transaction.annotation(sourceAnnotation)).toBe('clipboard');
        expect(transaction.isUserEvent('input.paste')).toBe(true);
    });

    it.each([
        ['Some text\n- ', 12, 'Some text\n- foo'],
        ['Some text\n1. ', 13, 'Some text\n1. foo'],
    ])('strips on an empty marker line directly after a paragraph (%j)', (doc, pos, expected) => {
        expect(paste(createState(doc, [[pos, pos]]), '- foo').doc.toString()).toBe(expected);
    });

    it('strips the pasted marker and task box on a task line', () => {
        const doc = '- [ ] ';
        expect(paste(createState(doc, [[6, 6]]), '- [x] foo').doc.toString()).toBe('- [ ] foo');
    });

    it('keeps a pasted task box on a plain list line', () => {
        expect(paste(createState('- ', [[2, 2]]), '- [ ] foo').doc.toString()).toBe('- [ ] foo');
    });

    it('strips when pasting before existing item text', () => {
        const result = paste(createState('  * bar', [[4, 4]]), '* foo');
        expect(result.doc.toString()).toBe('  * foobar');
        expect(result.selection.main.head).toBe(7);
    });

    it('uses the selection start when replacing text after the marker', () => {
        expect(paste(createState('- bar', [[2, 5]]), '- foo').doc.toString()).toBe('- foo');
    });

    it('does not strip when the cursor is after item text', () => {
        expect(paste(createState('- foo ', [[6, 6]]), '- bar').doc.toString()).toBe('- foo - bar');
    });

    it('does not strip inside a fenced code block', () => {
        expect(paste(createState('```\n- \n```', [[6, 6]]), '- foo').doc.toString()).toBe('```\n- - foo\n```');
    });

    it('does not strip with multiple selection ranges', () => {
        const state = createState('- \n- ', [
            [2, 2],
            [5, 5],
        ]);
        expect(paste(state, '- foo').doc.toString()).toBe('- - foo\n- - foo');
    });

    it('does not strip non-paste input', () => {
        expect(paste(createState('- ', [[2, 2]]), '- foo', 'input.type').doc.toString()).toBe('- - foo');
    });

    it('does nothing when disabled', () => {
        expect(paste(createState('- ', [[2, 2]], false), '- foo').doc.toString()).toBe('- - foo');
    });

    describe('ordered list renumbering', () => {
        it.each([
            ['sequential list', '1. x\n2. |\n3. y', '1. a\n2. b', '1. x\n2. a\n3. b\n4. y'],
            ['repeated numbers', '1. x\n1. |\n1. y\n1. z', '1. a\n1. b', '1. x\n1. a\n2. b\n3. y\n4. z'],
            ['paren delimiter', '1) |\n2) y', '1) a\n2) b', '1) a\n2) b\n3) y'],
            ['task items', '1. [ ] |\n2. [ ] y', '1. [x] a\n2. [ ] b', '1. [ ] a\n2. [ ] b\n3. [ ] y'],
            ['loose list', '1. |\n\n2. y', '1. a\n\n2. b', '1. a\n\n2. b\n\n3. y'],
            [
                'children and continuation lines',
                '1. |\n2. y\n   1. child\n   continuation\n3. z',
                '1. a\n   1. pasted child\n2. b',
                '1. a\n   1. pasted child\n2. b\n3. y\n   1. child\n   continuation\n4. z',
            ],
            ['nested target', '1. x\n   1. |\n   2. y\n2. z', '1. a\n   2. b', '1. x\n   1. a\n   2. b\n   3. y\n2. z'],
        ])('renumbers following items (%s)', (_name, doc, pasted, expected) => {
            expect(pasteAt(doc, pasted).doc.toString()).toBe(expected);
        });

        it.each([
            ['a different delimiter', '1. |\n2. y\n1) z', '1. a\n2. b', '1. a\n2. b\n3. y\n1) z'],
            ['a bullet sibling', '1. |\n- y\n2. z', '1. a\n2. b', '1. a\n2. b\n- y\n2. z'],
            ['a paragraph', '1. |\n2. y\n\nText\n\n1. other', '1. a\n2. b', '1. a\n2. b\n3. y\n\nText\n\n1. other'],
            ['a fence', '1. |\n```\n1. code\n```', '1. a\n2. b', '1. a\n2. b\n```\n1. code\n```'],
            ['a less indented line', '1. x\n   1. |\n2. y', '1. a\n   2. b', '1. x\n   1. a\n   2. b\n2. y'],
        ])('stops at %s', (_name, doc, pasted, expected) => {
            expect(pasteAt(doc, pasted).doc.toString()).toBe(expected);
        });

        it('renumbers pasted items re-indented to the target level', () => {
            expect(pasteAt('   1. |\n   2. y', '1. a\n2. b').doc.toString()).toBe('   1. a\n   2. b\n   3. y');
        });

        it('maps the cursor through a number width change', () => {
            const result = pasteAt('9. |\n10. y', '1. a\n2. b');
            expect(result.doc.toString()).toBe('9. a\n10. b\n11. y');
            expect(result.selection.main.head).toBe('9. a\n10. b'.length);
        });

        it('renumbers when the paste replaces a selection spanning lines', () => {
            const result = pasteAt('1. |old\n2. old|\n3. y', '1. a\n2. b\n3. c');
            expect(result.doc.toString()).toBe('1. a\n2. b\n3. c\n4. y');
        });

        it.each([
            ['a single-line paste', '1. x\n2. |\n3. y', '1. a', '1. x\n2. a\n3. y'],
            ['a bullet target', '- |\n1. y', '1. a\n2. b', '- a\n- b\n1. y'],
            ['a paste after item text', '1. x |\n2. y', '1. a\n2. b', '1. x 1. a\n2. b\n2. y'],
        ])('does not renumber for %s', (_name, doc, pasted, expected) => {
            expect(pasteAt(doc, pasted).doc.toString()).toBe(expected);
        });

        it('does not renumber when disabled', () => {
            expect(pasteAt('1. |\n2. y', '1. a\n2. b', false).doc.toString()).toBe('1. 1. a\n2. b\n2. y');
        });
    });

    describe('list type conversion', () => {
        it.each([
            ['bullets to ordered', '1. x\n2. |\n3. y', '- a\n- b', '1. x\n2. a\n3. b\n4. y'],
            ['ordered to bullets', '- |', '1. a\n2. b', '- a\n- b'],
            ['to the target bullet character', '* |', '- a\n+ b', '* a\n* b'],
            ['to the target delimiter', '1) |', '1. a\n2. b', '1) a\n2) b'],
            [
                'shifting children of widened markers',
                '1. |',
                '- a\n  - child\n- b\n  more',
                '1. a\n   - child\n2. b\n   more',
            ],
            [
                'keeping children of narrowed markers',
                '- |',
                '1. a\n   1. child\n2. b\n   more',
                '- a\n   1. child\n- b\n   more',
            ],
            [
                'shifting children past a number width change',
                '9. |',
                '- a\n  - c\n- b\n  - d',
                '9. a\n   - c\n10. b\n    - d',
            ],
            ['with re-indentation', '- x\n  1. |', '- a\n  - child\n- b', '- x\n  1. a\n     - child\n  2. b'],
            ['ordered task items to bullets', '- |', '1. [ ] a\n2. [x] b', '- [ ] a\n- [x] b'],
            ['plain bullets onto an ordered task item', '1. [ ] |', '- a\n- b', '1. [ ] a\n2. b'],
        ])('converts pasted siblings (%s)', (_name, doc, pasted, expected) => {
            expect(pasteAt(doc, pasted).doc.toString()).toBe(expected);
        });

        it('keeps 4-space children that stay nested under a widened marker', () => {
            const pasted = [
                '- Item 75',
                '    - Nested item 75.1',
                '        - Nested item 75.1.1',
                '- Item 76',
                '    - Nested item 76.1',
            ].join('\n');
            const expected = [
                '1. ABC',
                '2. Item 75',
                '    - Nested item 75.1',
                '        - Nested item 75.1.1',
                '3. Item 76',
                '    - Nested item 76.1',
                '4. DEF',
            ].join('\n');
            expect(pasteAt('1. ABC\n2. |\n3. DEF', pasted).doc.toString()).toBe(expected);
        });

        it('keeps 4-space children under a narrowed marker', () => {
            const pasted = '1. a\n    - child\n        - grandchild\n2. b\n    - child';
            expect(pasteAt('- |', pasted).doc.toString()).toBe(
                '- a\n    - child\n        - grandchild\n- b\n    - child'
            );
        });

        it('moves children the minimum amount when they would become code', () => {
            expect(pasteAt('- |', '10. a\n       - child\n         - grandchild\n11. b').doc.toString()).toBe(
                '- a\n     - child\n       - grandchild\n- b'
            );
        });

        it('moves a subtree together when children would fall out of a widened marker', () => {
            expect(pasteAt('1. |', '- a\n  - child\n    - grandchild\n- b').doc.toString()).toBe(
                '1. a\n   - child\n     - grandchild\n2. b'
            );
        });

        it('keeps tab-indented children as tabs', () => {
            const tabs = [indentUnit.of('\t'), EditorState.tabSize.of(4)];
            expect(pasteAt('1. x\n2. |', '- a\n\t- child\n\t\t- grandchild\n- b', true, tabs).doc.toString()).toBe(
                '1. x\n2. a\n\t- child\n\t\t- grandchild\n3. b'
            );
        });

        it('keeps the whitespace of lines that do not move', () => {
            const tabs = [indentUnit.of('\t'), EditorState.tabSize.of(4)];
            expect(pasteAt('1. x\n2. |', '- a\n    - child\n- b', true, tabs).doc.toString()).toBe(
                '1. x\n2. a\n    - child\n3. b'
            );
        });

        it('keeps the first bulleted task item and its siblings as bullets on a numbered target', () => {
            expect(pasteAt('1. |\n2. y', '- [ ] a\n- b').doc.toString()).toBe('- [ ] a\n- b\n2. y');
            expect(pasteAt('1. |\n2. y', '- [ ] a\n- [ ] b').doc.toString()).toBe('- [ ] a\n- [ ] b\n2. y');
        });

        it('uses the pasted bullet for the first task item and later siblings', () => {
            expect(pasteAt('9. |\n10. y', '* [x] a\n  - child\n+ b').doc.toString()).toBe(
                '* [x] a\n  - child\n* b\n10. y'
            );
        });

        it('keeps the target task box when replacing a numbered task marker', () => {
            expect(pasteAt('2. [ ] |', '- [x] a\n- b').doc.toString()).toBe('- [ ] a\n- b');
        });

        it('handles a shorter empty task item after a wide numbered marker', () => {
            expect(pasteAt('123456789. |', '- [ ] ').doc.toString()).toBe('- [ ] ');
        });

        it('stops converting after a sibling-level paragraph', () => {
            expect(pasteAt('1. |', '- a\n\ntext\n\n- b').doc.toString()).toBe('1. a\n\ntext\n\n- b');
        });

        it('maps the cursor through marker width changes', () => {
            const result = pasteAt('9. |', '- a\n- b');
            expect(result.doc.toString()).toBe('9. a\n10. b');
            expect(result.selection.main.head).toBe(result.doc.length);
        });
    });

    describe('re-indentation', () => {
        it.each([
            [
                'top-level list into a nested item',
                '- x\n  - |',
                '- a\n  - child\n- b',
                '- x\n  - a\n    - child\n  - b',
            ],
            ['nested list to top level', '- |', '   - a\n      - child\n   - b', '- a\n   - child\n- b'],
            ['a continuation line', '  - |', '- a\n  more\n- b', '  - a\n    more\n  - b'],
            ['past blank lines', '  - |', '- a\n\n- b', '  - a\n\n  - b'],
            ['clamped at zero', '- |', '    - a\n  - b', '- a\n- b'],
        ])('shifts later pasted lines (%s)', (_name, doc, pasted, expected) => {
            expect(pasteAt(doc, pasted).doc.toString()).toBe(expected);
        });

        it('maps the cursor to the end of the re-indented paste', () => {
            const result = pasteAt('  - |', '- a\n- b');
            expect(result.doc.toString()).toBe('  - a\n  - b');
            expect(result.selection.main.head).toBe(result.doc.length);
        });

        it('does not re-indent document text after a paste ending in a newline', () => {
            expect(pasteAt('  - |x', '- a\n- b\n').doc.toString()).toBe('  - a\n  - b\nx');
        });

        it('uses the indent unit for the new indentation', () => {
            const tabs = [indentUnit.of('\t'), EditorState.tabSize.of(4)];
            expect(pasteAt('- x\n\t- |', '- a\n    - child\n- b', true, tabs).doc.toString()).toBe(
                '- x\n\t- a\n\t\t- child\n\t- b'
            );
        });

        it('does not re-indent when the first pasted line may have lost its indentation', () => {
            expect(pasteAt('- |', '1. a\n   2. b').doc.toString()).toBe('- a\n   2. b');
        });

        it('re-indents an unindented first line when a later line confirms the level', () => {
            expect(pasteAt('  - |', '- a\n  - child\n- b').doc.toString()).toBe('  - a\n    - child\n  - b');
        });

        it('does not re-indent when the paste is already at the target level', () => {
            expect(pasteAt('  - x\n  - |', '  - a\n  - b').doc.toString()).toBe('  - x\n  - a\n  - b');
        });

        it('does not re-indent when disabled', () => {
            expect(pasteAt('  - |', '- a\n- b', false).doc.toString()).toBe('  - - a\n- b');
        });
    });
});

describe('getPastedLineChanges', () => {
    const reindent = (doc: string, pasteFrom: number, pasted: string, linePrefix: string) =>
        getPastedLineChanges(Text.of(doc.split('\n')), pasteFrom, pasted, linePrefix, 4, (columns) =>
            ' '.repeat(columns)
        );

    it('returns no changes for a single-line paste', () => {
        expect(reindent('  - a', 4, '- a', '  - ')).toEqual([]);
    });

    it('replaces only the leading whitespace of later lines', () => {
        expect(reindent('  - - a\n- b', 4, '- a\n- b', '  - ')).toEqual([{ from: 8, to: 8, insert: '  ' }]);
    });
});
