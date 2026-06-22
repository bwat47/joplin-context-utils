/* eslint-disable @typescript-eslint/no-explicit-any */
import { EditorSelection, EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { detectContextAtPosition } from './contextDetection';
import { EditorContext } from '../types';

describe('contextDetection', () => {
    const createViewWithSelection = (doc: string, from: number, to: number) => {
        const state = EditorState.create({
            doc,
            selection: EditorSelection.single(from, to),
            extensions: [
                EditorState.allowMultipleSelections.of(true),
                markdown({
                    extensions: [GFM],
                }),
            ],
        });
        return { state } as any;
    };

    const createViewWithRanges = (doc: string, ranges: Array<[number, number]>, mainIndex = 0) => {
        const state = EditorState.create({
            doc,
            selection: EditorSelection.create(
                ranges.map(([anchor, head]) => EditorSelection.range(anchor, head)),
                mainIndex
            ),
            extensions: [
                EditorState.allowMultipleSelections.of(true),
                markdown({
                    extensions: [GFM],
                }),
            ],
        });
        return { state } as any;
    };

    const createViewWithCursor = (doc: string, pos: number) => {
        return createViewWithSelection(doc, pos, pos);
    };

    const getLinkSelection = (contexts: ReturnType<typeof detectContextAtPosition>) => {
        return contexts.find((context) => context.contextType === 'linkSelection');
    };

    const getContext = <T extends EditorContext['contextType']>(
        contexts: ReturnType<typeof detectContextAtPosition>,
        contextType: T
    ) => {
        return contexts.find((context) => context.contextType === contextType) as
            | Extract<EditorContext, { contextType: T }>
            | undefined;
    };

    it('deduplicates autolink URL nodes in selection', () => {
        const doc = '<https://joplinapp.org>';
        const view = createViewWithSelection(doc, 0, doc.length);
        const contexts = detectContextAtPosition(view, 0);
        const linkSelection = getLinkSelection(contexts);

        expect(linkSelection).toBeDefined();
        expect(linkSelection?.links).toHaveLength(1);
        expect(linkSelection?.links[0].expectedText).toBe(doc);
    });

    it('returns one link for a bare URL selection', () => {
        const doc = 'https://joplinapp.org';
        const view = createViewWithSelection(doc, 0, doc.length);
        const contexts = detectContextAtPosition(view, 0);
        const linkSelection = getLinkSelection(contexts);

        expect(linkSelection).toBeDefined();
        expect(linkSelection?.links).toHaveLength(1);
        expect(linkSelection?.links[0].expectedText).toBe(doc);
    });

    it('preserves title attributes for markdown links in selection', () => {
        const doc = '[Joplin](https://joplinapp.org "Docs Title")';
        const view = createViewWithSelection(doc, 0, doc.length);
        const contexts = detectContextAtPosition(view, 0);
        const linkSelection = getLinkSelection(contexts);

        expect(linkSelection).toBeDefined();
        expect(linkSelection?.links).toHaveLength(1);
        expect(linkSelection?.links[0].linkTitleToken).toBe('"Docs Title"');
        expect(linkSelection?.links[0].expectedText).toBe(doc);
    });

    it('does not count a URL-shaped markdown link label as a second selection link', () => {
        const doc = '[https://google.com](https://google.com)';
        const view = createViewWithSelection(doc, 0, doc.length);
        const contexts = detectContextAtPosition(view, 0);
        const linkSelection = getLinkSelection(contexts);

        expect(linkSelection).toBeDefined();
        expect(linkSelection?.links).toHaveLength(1);
        expect(linkSelection?.links[0].url).toBe('https://google.com');
        expect(linkSelection?.links[0].expectedText).toBe(doc);
    });

    it('excludes reference-style links from selection', () => {
        const doc = '[Ref][r]\n\n[r]: https://joplinapp.org';
        const view = createViewWithSelection(doc, 0, '[Ref][r]'.length);
        const contexts = detectContextAtPosition(view, 0);
        const linkSelection = getLinkSelection(contexts);

        expect(linkSelection).toBeUndefined();
    });

    it('does not count a URL-shaped reference link label as a selection link', () => {
        const doc = '[https://google.com][ref]\n\n[ref]: https://google.com';
        const selectedText = '[https://google.com][ref]';
        const view = createViewWithSelection(doc, 0, selectedText.length);
        const contexts = detectContextAtPosition(view, 0);
        const linkSelection = getLinkSelection(contexts);

        expect(linkSelection).toBeUndefined();
    });

    it('excludes markdown images from selection', () => {
        const doc = '![Alt](https://joplinapp.org/logo.png "Logo")';
        const view = createViewWithSelection(doc, 0, doc.length);
        const contexts = detectContextAtPosition(view, 0);
        const linkSelection = getLinkSelection(contexts);

        expect(linkSelection).toBeUndefined();
    });

    it('excludes html img tags from selection', () => {
        const doc = '<img src="https://joplinapp.org/logo.png" alt="Logo" />';
        const view = createViewWithSelection(doc, 0, doc.length);
        const contexts = detectContextAtPosition(view, 0);
        const linkSelection = getLinkSelection(contexts);

        expect(linkSelection).toBeUndefined();
    });

    it('detects task context on an unchecked task line', () => {
        const doc = '- [ ] Task item';
        const view = createViewWithCursor(doc, doc.indexOf('['));
        const contexts = detectContextAtPosition(view, doc.indexOf('['));
        const taskContext = getContext(contexts, 'task');

        expect(taskContext).toBeDefined();
        expect(taskContext?.tasks).toHaveLength(1);
        expect(taskContext?.checkedCount).toBe(0);
        expect(taskContext?.uncheckedCount).toBe(1);
        expect(taskContext?.tasks[0].checked).toBe(false);
        expect(taskContext?.tasks[0].lineText).toBe(doc);
    });

    it('detects task context on a checked task line', () => {
        const doc = '- [x] Task item';
        const view = createViewWithCursor(doc, doc.indexOf('['));
        const contexts = detectContextAtPosition(view, doc.indexOf('['));
        const taskContext = getContext(contexts, 'task');

        expect(taskContext).toBeDefined();
        expect(taskContext?.tasks).toHaveLength(1);
        expect(taskContext?.checkedCount).toBe(1);
        expect(taskContext?.uncheckedCount).toBe(0);
        expect(taskContext?.tasks[0].checked).toBe(true);
        expect(taskContext?.tasks[0].lineText).toBe(doc);
    });

    it('detects task context for a selection with counts', () => {
        const doc = '- [ ] Task one\n- [x] Task two';
        const view = createViewWithSelection(doc, 0, doc.length);
        const contexts = detectContextAtPosition(view, 0);
        const taskContext = getContext(contexts, 'task');

        expect(taskContext).toBeDefined();
        expect(taskContext?.tasks).toHaveLength(2);
        expect(taskContext?.checkedCount).toBe(1);
        expect(taskContext?.uncheckedCount).toBe(1);
    });

    it('aggregates task context from multiple cursors on task lines', () => {
        const doc = '- [ ] Task one\n- [x] Task two\nPlain text';
        const firstTaskPos = doc.indexOf('Task one');
        const secondTaskPos = doc.indexOf('Task two');
        const view = createViewWithRanges(doc, [
            [firstTaskPos, firstTaskPos],
            [secondTaskPos, secondTaskPos],
        ]);
        const contexts = detectContextAtPosition(view, firstTaskPos);
        const taskContext = getContext(contexts, 'task');

        expect(taskContext).toBeDefined();
        expect(taskContext?.tasks).toHaveLength(2);
        expect(taskContext?.checkedCount).toBe(1);
        expect(taskContext?.uncheckedCount).toBe(1);
        expect(taskContext?.tasks.map((task) => task.lineText)).toEqual(['- [ ] Task one', '- [x] Task two']);
    });

    it('aggregates task context from multiple selected ranges', () => {
        const doc = '- [ ] First\nPlain text\n- [x] Second';
        const firstFrom = 0;
        const firstTo = '- [ ] First'.length;
        const secondFrom = doc.indexOf('- [x]');
        const secondTo = doc.length;
        const view = createViewWithRanges(doc, [
            [firstFrom, firstTo],
            [secondFrom, secondTo],
        ]);
        const contexts = detectContextAtPosition(view, firstFrom);
        const taskContext = getContext(contexts, 'task');

        expect(taskContext).toBeDefined();
        expect(taskContext?.tasks).toHaveLength(2);
        expect(taskContext?.checkedCount).toBe(1);
        expect(taskContext?.uncheckedCount).toBe(1);
    });

    it('aggregates task context from mixed cursor and selection ranges', () => {
        const doc = '- [ ] Cursor task\nPlain text\n- [x] Selected task';
        const cursorPos = doc.indexOf('Cursor');
        const selectionFrom = doc.indexOf('- [x]');
        const selectionTo = doc.length;
        const view = createViewWithRanges(doc, [
            [cursorPos, cursorPos],
            [selectionFrom, selectionTo],
        ]);
        const contexts = detectContextAtPosition(view, cursorPos);
        const taskContext = getContext(contexts, 'task');

        expect(taskContext).toBeDefined();
        expect(taskContext?.tasks).toHaveLength(2);
        expect(taskContext?.checkedCount).toBe(1);
        expect(taskContext?.uncheckedCount).toBe(1);
    });

    it('deduplicates multiple cursors on the same task line', () => {
        const doc = '- [ ] Same task';
        const firstCursor = doc.indexOf('[');
        const secondCursor = doc.indexOf('task');
        const view = createViewWithRanges(doc, [
            [firstCursor, firstCursor],
            [secondCursor, secondCursor],
        ]);
        const contexts = detectContextAtPosition(view, firstCursor);
        const taskContext = getContext(contexts, 'task');

        expect(taskContext).toBeDefined();
        expect(taskContext?.tasks).toHaveLength(1);
        expect(taskContext?.uncheckedCount).toBe(1);
        expect(taskContext?.tasks[0].lineText).toBe(doc);
    });

    it('detects main cursor code and task context from another cursor', () => {
        const doc = 'Use `render` here\n- [ ] Task item';
        const codePos = doc.indexOf('render');
        const taskPos = doc.indexOf('Task item');
        const view = createViewWithRanges(doc, [
            [codePos, codePos],
            [taskPos, taskPos],
        ]);
        const contexts = detectContextAtPosition(view, codePos);

        const codeContext = getContext(contexts, 'code');
        const taskContext = getContext(contexts, 'task');

        expect(codeContext).toBeDefined();
        expect(codeContext?.code).toBe('render');
        expect(taskContext).toBeDefined();
        expect(taskContext?.tasks).toHaveLength(1);
        expect(taskContext?.uncheckedCount).toBe(1);
    });

    it('detects inline code context', () => {
        const doc = 'Use `code` here';
        const pos = doc.indexOf('code');
        const view = createViewWithCursor(doc, pos);
        const contexts = detectContextAtPosition(view, pos);
        const codeContext = getContext(contexts, 'code');

        expect(codeContext).toBeDefined();
        expect(codeContext?.code).toBe('code');
    });

    it('detects fenced code block context', () => {
        const doc = '```\nconst x = 1;\n```';
        const pos = doc.indexOf('const');
        const view = createViewWithCursor(doc, pos);
        const contexts = detectContextAtPosition(view, pos);
        const codeContext = getContext(contexts, 'code');

        expect(codeContext).toBeDefined();
        expect(codeContext?.code).toContain('const x = 1;');
    });

    it('detects footnote context at cursor', () => {
        const doc = 'Note[^1]\n\n[^1]: Footnote text';
        const pos = doc.indexOf('^1');
        const view = createViewWithCursor(doc, pos);
        const contexts = detectContextAtPosition(view, pos);
        const footnoteContext = getContext(contexts, 'footnote');

        expect(footnoteContext).toBeDefined();
        expect(footnoteContext?.label).toBe('1');
        expect(footnoteContext?.targetPos).toBe(doc.indexOf('[^1]:'));
    });

    it('detects markdown link context at cursor', () => {
        const doc = '[Joplin](https://joplinapp.org)';
        const pos = doc.indexOf('Joplin');
        const view = createViewWithCursor(doc, pos);
        const contexts = detectContextAtPosition(view, pos);
        const linkContext = getContext(contexts, 'link');

        expect(linkContext).toBeDefined();
        expect(linkContext?.type).toBe('external-url');
        expect(linkContext?.url).toBe('https://joplinapp.org');
        expect(linkContext?.markdownLinkFrom).toBe(0);
        expect(linkContext?.markdownLinkTo).toBe(doc.length);
    });

    it('marks markdown image links as image contexts', () => {
        const doc = '![Alt](https://joplinapp.org/logo.png "Logo")';
        const pos = doc.indexOf('Alt');
        const view = createViewWithCursor(doc, pos);
        const contexts = detectContextAtPosition(view, pos);
        const linkContext = getContext(contexts, 'link');

        expect(linkContext).toBeDefined();
        expect(linkContext?.type).toBe('external-url');
        expect(linkContext?.isImage).toBe(true);
    });

    it('detects heading context on a heading line', () => {
        const doc = '# My Heading';
        const pos = doc.indexOf('Heading');
        const view = createViewWithCursor(doc, pos);
        const contexts = detectContextAtPosition(view, pos);
        const headingContext = getContext(contexts, 'heading');

        expect(headingContext).toBeDefined();
        expect(headingContext?.headingText).toBe('My Heading');
        expect(headingContext?.headingAnchor).toBe('my-heading');
        expect(contexts).toHaveLength(1);
    });

    it('detects both code AND heading for inline code inside a heading', () => {
        const doc = '# Use `render` here';
        const pos = doc.indexOf('render');
        const view = createViewWithCursor(doc, pos);
        const contexts = detectContextAtPosition(view, pos);

        const codeContext = getContext(contexts, 'code');
        const headingContext = getContext(contexts, 'heading');

        expect(codeContext).toBeDefined();
        expect(codeContext?.code).toBe('render');
        expect(headingContext).toBeDefined();
        expect(headingContext?.headingAnchor).toBe('use-render-here');
    });

    it('does not detect a heading context on a non-heading line', () => {
        const doc = '# Heading\n\nA plain paragraph';
        const pos = doc.indexOf('plain');
        const view = createViewWithCursor(doc, pos);
        const contexts = detectContextAtPosition(view, pos);

        expect(getContext(contexts, 'heading')).toBeUndefined();
    });

    it('detects quote context on a quote line', () => {
        const doc = '> Quoted text';
        const pos = doc.indexOf('Quoted');
        const view = createViewWithCursor(doc, pos);
        const contexts = detectContextAtPosition(view, pos);
        const quoteContext = getContext(contexts, 'quote');

        expect(quoteContext).toBeDefined();
        expect(quoteContext?.quoteText).toBe('Quoted text');
        expect(contexts).toHaveLength(1);
    });

    it('detects both code AND quote for inline code inside a quote', () => {
        const doc = '> Use `render` here';
        const pos = doc.indexOf('render');
        const view = createViewWithCursor(doc, pos);
        const contexts = detectContextAtPosition(view, pos);

        const codeContext = getContext(contexts, 'code');
        const quoteContext = getContext(contexts, 'quote');

        expect(codeContext).toBeDefined();
        expect(codeContext?.code).toBe('render');
        expect(quoteContext).toBeDefined();
        expect(quoteContext?.quoteText).toBe('Use `render` here');
    });

    it('detects both link AND quote for a link inside a quote', () => {
        const doc = '> Visit [Joplin](https://joplinapp.org)';
        const pos = doc.indexOf('Joplin');
        const view = createViewWithCursor(doc, pos);
        const contexts = detectContextAtPosition(view, pos);

        const linkContext = getContext(contexts, 'link');
        const quoteContext = getContext(contexts, 'quote');

        expect(linkContext).toBeDefined();
        expect(linkContext?.url).toBe('https://joplinapp.org');
        expect(quoteContext).toBeDefined();
        expect(quoteContext?.quoteText).toBe('Visit [Joplin](https://joplinapp.org)');
    });

    it('detects a task on a task line inside a quote', () => {
        const doc = '> - [ ] task in quote';
        const pos = doc.indexOf('task');
        const view = createViewWithCursor(doc, pos);
        const contexts = detectContextAtPosition(view, pos);
        const taskContext = getContext(contexts, 'task');

        expect(taskContext).toBeDefined();
        expect(taskContext?.tasks).toHaveLength(1);
        expect(taskContext?.uncheckedCount).toBe(1);
        expect(taskContext?.tasks[0].checked).toBe(false);
        expect(taskContext?.tasks[0].lineText).toBe('> - [ ] task in quote');
    });

    it('detects a checked task inside a nested quote', () => {
        const doc = '> > - [x] done in nested quote';
        const pos = doc.indexOf('done');
        const view = createViewWithCursor(doc, pos);
        const contexts = detectContextAtPosition(view, pos);
        const taskContext = getContext(contexts, 'task');

        expect(taskContext).toBeDefined();
        expect(taskContext?.tasks).toHaveLength(1);
        expect(taskContext?.checkedCount).toBe(1);
        expect(taskContext?.tasks[0].checked).toBe(true);
    });

    it('detects task context for selected task lines inside a quote', () => {
        const doc = '> - [ ] first\n> - [x] second';
        const view = createViewWithSelection(doc, 0, doc.length);
        const contexts = detectContextAtPosition(view, 0);
        const taskContext = getContext(contexts, 'task');

        expect(taskContext).toBeDefined();
        expect(taskContext?.tasks).toHaveLength(2);
        expect(taskContext?.checkedCount).toBe(1);
        expect(taskContext?.uncheckedCount).toBe(1);
    });

    it('detects both code AND task for inline code inside a task', () => {
        const doc = '- [ ] Use `render` here';
        const pos = doc.indexOf('render');
        const view = createViewWithCursor(doc, pos);
        const contexts = detectContextAtPosition(view, pos);

        const codeContext = getContext(contexts, 'code');
        const taskContext = getContext(contexts, 'task');

        expect(codeContext).toBeDefined();
        expect(codeContext?.code).toBe('render');
        expect(taskContext).toBeDefined();
        expect(taskContext?.tasks).toHaveLength(1);
        expect(taskContext?.uncheckedCount).toBe(1);
    });
});
