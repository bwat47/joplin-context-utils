/* eslint-disable @typescript-eslint/no-explicit-any */
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { getQuoteAtPosition } from './quoteExtraction';

describe('quoteExtraction', () => {
    const createView = (doc: string) => {
        const state = EditorState.create({
            doc,
            extensions: [
                markdown({
                    extensions: [GFM],
                }),
            ],
        });
        return { state } as any;
    };

    const quoteAt = (doc: string, needle: string) => {
        const view = createView(doc);
        const pos = doc.indexOf(needle) + 1;
        return getQuoteAtPosition(view, pos);
    };

    it('copies a single-line quote without the quote marker', () => {
        expect(quoteAt('> hello', 'hello')?.text).toBe('hello');
    });

    it('copies a multi-line quote without quote markers', () => {
        expect(quoteAt('> one\n> two', 'two')?.text).toBe('one\ntwo');
    });

    it('preserves markdown syntax inside the quote', () => {
        expect(quoteAt('> [x](url) and `code`', 'code')?.text).toBe('[x](url) and `code`');
    });

    it('normalizes nested quotes by removing all quote markers', () => {
        expect(quoteAt('> outer\n> > inner', 'inner')?.text).toBe('outer\ninner');
    });

    it('preserves list markdown after removing quote markers', () => {
        expect(quoteAt('> - item\n>   - nested', 'nested')?.text).toBe('- item\n  - nested');
    });

    it('returns null when the cursor is outside a quote', () => {
        const doc = '> quote\n\nplain text';
        const view = createView(doc);
        expect(getQuoteAtPosition(view, doc.indexOf('plain'))).toBeNull();
    });
});
