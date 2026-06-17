/* eslint-disable @typescript-eslint/no-explicit-any */
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { getHeadingAtPosition } from './headingExtraction';

describe('headingExtraction', () => {
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

    // Returns the heading detected when the cursor sits inside the line containing `needle`
    const headingAt = (doc: string, needle: string) => {
        const view = createView(doc);
        const pos = doc.indexOf(needle) + 1;
        return getHeadingAtPosition(view, pos);
    };

    it('detects a simple ATX heading and slugifies its text', () => {
        const result = headingAt('# Introduction', 'Introduction');
        expect(result).toEqual({ text: 'Introduction', anchor: 'introduction' });
    });

    it('detects ATX headings of any level', () => {
        const doc = '###### Deep Heading';
        expect(headingAt(doc, 'Deep')).toEqual({ text: 'Deep Heading', anchor: 'deep-heading' });
    });

    it('detects Setext (underlined) headings', () => {
        const doc = 'Underlined Title\n================';
        expect(headingAt(doc, 'Underlined')).toEqual({
            text: 'Underlined Title',
            anchor: 'underlined-title',
        });
    });

    it('suffixes duplicate headings in document order', () => {
        const doc = '# Intro\n\n# Intro\n\n# Intro';
        const view = createView(doc);

        const firstPos = doc.indexOf('# Intro') + 1;
        const secondPos = doc.indexOf('# Intro', firstPos + 1) + 1;
        const thirdPos = doc.indexOf('# Intro', secondPos + 1) + 1;

        expect(getHeadingAtPosition(view, firstPos)?.anchor).toBe('intro');
        expect(getHeadingAtPosition(view, secondPos)?.anchor).toBe('intro-2');
        expect(getHeadingAtPosition(view, thirdPos)?.anchor).toBe('intro-3');
    });

    it('includes inline code text in the heading text and anchor', () => {
        const result = headingAt('# Use the `render` method', 'render');
        expect(result).toEqual({ text: 'Use the render method', anchor: 'use-the-render-method' });
    });

    it('uses link label text and ignores the URL', () => {
        const result = headingAt('# See [the docs](https://example.com)', 'docs');
        expect(result).toEqual({ text: 'See the docs', anchor: 'see-the-docs' });
    });

    it('strips emphasis marks', () => {
        const result = headingAt('# **Bold** and *italic*', 'Bold');
        expect(result).toEqual({ text: 'Bold and italic', anchor: 'bold-and-italic' });
    });

    it('strips unsupported highlight (==) and insert (++) formatting', () => {
        const result = headingAt('# ==Important== ++new++', 'Important');
        expect(result).toEqual({ text: 'Important new', anchor: 'important-new' });
    });

    it('returns null when the cursor is not on a heading', () => {
        const doc = '# Heading\n\nSome paragraph text';
        const view = createView(doc);
        const pos = doc.indexOf('paragraph');
        expect(getHeadingAtPosition(view, pos)).toBeNull();
    });

    it('returns null for an empty heading (no text)', () => {
        const doc = '#';
        const view = createView(doc);
        expect(getHeadingAtPosition(view, 1)).toBeNull();
    });
});
