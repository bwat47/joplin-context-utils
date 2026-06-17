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

    it('includes lazy continuation lines without a quote marker', () => {
        expect(quoteAt('> line one\nline two', 'line two')?.text).toBe('line one\nline two');
    });

    it('normalizes nested quotes by removing all quote markers', () => {
        expect(quoteAt('> outer\n> > inner', 'inner')?.text).toBe('outer\ninner');
    });

    it('preserves list markdown after removing quote markers', () => {
        expect(quoteAt('> - item\n>   - nested', 'nested')?.text).toBe('- item\n  - nested');
    });

    it('removes a leading GitHub alert marker from copied text', () => {
        const doc = '> [!NOTE]\n> Useful information that users should know, even when skimming content.';

        expect(quoteAt(doc, 'Useful')?.text).toBe(
            'Useful information that users should know, even when skimming content.'
        );
    });

    it('removes blank lines left after a leading GitHub alert marker', () => {
        const doc = '> [!WARNING]\n>\n> Important details';

        expect(quoteAt(doc, 'Important')?.text).toBe('Important details');
    });

    it('removes extended Joplin alert markers from copied text', () => {
        const doc = '> [!ABSTRACT]\n> A summary or overview of the content that follows.';

        expect(quoteAt(doc, 'summary')?.text).toBe('A summary or overview of the content that follows.');
    });

    it('removes extended alert markers case-insensitively', () => {
        const doc = '> [!danger]\n> Critical warning about something that could cause serious harm.';

        expect(quoteAt(doc, 'Critical')?.text).toBe(
            'Critical warning about something that could cause serious harm.'
        );
    });

    it('removes custom leading alert markers from copied text', () => {
        const doc = '> [!CUSTOM]\n> Custom marker text';

        expect(quoteAt(doc, 'Custom')?.text).toBe('Custom marker text');
    });

    it('preserves the title when an alert marker has one', () => {
        const doc = '> [!NOTE] Custom Title\n> Body of the note that follows the title.';

        expect(quoteAt(doc, 'Body')?.text).toBe('Custom Title\nBody of the note that follows the title.');
    });

    it('keeps an alert title even when it is the only quote content', () => {
        const doc = '> [!WARNING] Watch out here';

        expect(quoteAt(doc, 'Watch')?.text).toBe('Watch out here');
    });

    it('preserves GitHub alert-like text when it is not the leading line', () => {
        const doc = '> First line\n> [!NOTE]\n> Still part of the quote';

        expect(quoteAt(doc, 'Still')?.text).toBe('First line\n[!NOTE]\nStill part of the quote');
    });

    it('returns null when the cursor is outside a quote', () => {
        const doc = '> quote\n\nplain text';
        const view = createView(doc);
        expect(getQuoteAtPosition(view, doc.indexOf('plain'))).toBeNull();
    });
});
