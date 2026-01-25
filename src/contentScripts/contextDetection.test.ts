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

    it('excludes reference-style links from selection', () => {
        const doc = '[Ref][r]\n\n[r]: https://joplinapp.org';
        const view = createViewWithSelection(doc, 0, '[Ref][r]'.length);
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

    it('detects checkbox context on a task line', () => {
        const doc = '- [ ] Task item';
        const view = createViewWithCursor(doc, doc.indexOf('['));
        const contexts = detectContextAtPosition(view, doc.indexOf('['));
        const checkboxContext = getContext(contexts, 'checkbox');

        expect(checkboxContext).toBeDefined();
        expect(checkboxContext?.checked).toBe(false);
        expect(checkboxContext?.lineText).toBe(doc);
    });

    it('detects task selection context with counts', () => {
        const doc = '- [ ] Task one\n- [x] Task two';
        const view = createViewWithSelection(doc, 0, doc.length);
        const contexts = detectContextAtPosition(view, 0);
        const taskSelection = getContext(contexts, 'taskSelection');

        expect(taskSelection).toBeDefined();
        expect(taskSelection?.tasks).toHaveLength(2);
        expect(taskSelection?.checkedCount).toBe(1);
        expect(taskSelection?.uncheckedCount).toBe(1);
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
});
