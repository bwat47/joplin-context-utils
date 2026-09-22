import { Annotation, ChangeSet, EditorSelection, EditorState, StateEffect, Text, Transaction } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { createPasteCleanupExtension, getListRenumberChanges, stripDuplicateListMarker } from './pasteCleanup';

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
    const createState = (doc: string, ranges: Array<[number, number]>, enabled = true) =>
        EditorState.create({
            doc,
            selection: EditorSelection.create(ranges.map(([anchor, head]) => EditorSelection.range(anchor, head))),
            extensions: [
                EditorState.allowMultipleSelections.of(true),
                markdown({ extensions: [GFM] }),
                createPasteCleanupExtension(() => enabled),
            ],
        });

    /** Mirrors Joplin's `insertText(text, UserEventSource.Paste)` */
    const paste = (state: EditorState, text: string, userEvent = 'input.paste') =>
        state.update(state.replaceSelection(text), { userEvent }).state;

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
        /** Pastes at the cursor (`|`) or over the selection (`|...|`) marked in `docWithCursor`. */
        const pasteAt = (docWithCursor: string, text: string, enabled = true) => {
            const anchor = docWithCursor.indexOf('|');
            const head = docWithCursor.indexOf('|', anchor + 1);
            const doc = docWithCursor.replace(/\|/g, '');
            const range: [number, number] = head === -1 ? [anchor, anchor] : [anchor, head - 1];
            return paste(createState(doc, [range], enabled), text);
        };

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

        it('does not renumber pasted items at a different indentation', () => {
            expect(pasteAt('   1. |\n   2. y', '1. a\n2. b').doc.toString()).toBe('   1. a\n2. b\n   2. y');
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
            ['a bullet target', '- |\n- y', '1. a\n2. b', '- a\n2. b\n- y'],
            ['pasted bullets', '1. |\n2. y', '- a\n- b', '1. a\n- b\n2. y'],
            ['a paste after item text', '1. x |\n2. y', '1. a\n2. b', '1. x 1. a\n2. b\n2. y'],
        ])('does not renumber for %s', (_name, doc, pasted, expected) => {
            expect(pasteAt(doc, pasted).doc.toString()).toBe(expected);
        });

        it('does not renumber when disabled', () => {
            expect(pasteAt('1. |\n2. y', '1. a\n2. b', false).doc.toString()).toBe('1. 1. a\n2. b\n2. y');
        });
    });
});
