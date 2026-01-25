/* eslint-disable @typescript-eslint/no-explicit-any */
import { EditorSelection, EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { detectContextAtPosition } from './contextDetection';

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

    const getLinkSelection = (contexts: ReturnType<typeof detectContextAtPosition>) => {
        return contexts.find((context) => context.contextType === 'linkSelection');
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
});
