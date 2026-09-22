import { Annotation, EditorSelection, EditorState, StateEffect, Transaction } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { createPasteCleanupExtension, stripDuplicateListMarker } from './pasteCleanup';

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
});
