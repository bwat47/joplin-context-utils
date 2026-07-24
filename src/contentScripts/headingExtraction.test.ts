/* eslint-disable @typescript-eslint/no-explicit-any */
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM, type InlineContext, type MarkdownConfig } from '@lezer/markdown';
import { getHeadingAtPosition } from './headingExtraction';

const DOLLAR_SIGN_CHARCODE = 36;
const BACKSLASH_CHARCODE = 92;

/**
 * Joplin marks `$...$` as an `InlineMath` node wrapping an `InlineMathContent` node, and
 * hands the content to a TeX parser. That grammar is app-internal, so tests approximate it
 * here. The TeX parse is omitted: the extractor copies `InlineMath` verbatim from the
 * source, so nothing below that node is ever visited.
 *
 * @see https://github.com/laurent22/joplin/blob/dev/packages/editor/CodeMirror/extensions/markdownMathExtension.ts
 */
const inlineMathConfig: MarkdownConfig = {
    defineNodes: [{ name: 'InlineMath' }, { name: 'InlineMathContent' }],
    parseInline: [
        {
            name: 'InlineMath',
            after: 'InlineCode',
            parse(cx: InlineContext, current: number, pos: number): number {
                const prevCharCode = pos - 1 >= 0 ? cx.char(pos - 1) : -1;
                const nextCharCode = cx.char(pos + 1);
                if (
                    current !== DOLLAR_SIGN_CHARCODE ||
                    prevCharCode === DOLLAR_SIGN_CHARCODE ||
                    nextCharCode === DOLLAR_SIGN_CHARCODE ||
                    /\s/.test(String.fromCharCode(nextCharCode))
                ) {
                    return -1;
                }

                const start = pos;
                const end = cx.end;
                let escaped = false;

                // Scan ahead for the next unescaped '$'
                for (pos++; pos < end && (escaped || cx.char(pos) !== DOLLAR_SIGN_CHARCODE); pos++) {
                    escaped = !escaped && cx.char(pos) === BACKSLASH_CHARCODE;
                }

                // Not math when the region is unterminated or the closing '$' follows a space
                if (pos === end || /\s/.test(String.fromCharCode(cx.char(pos - 1)))) {
                    return -1;
                }

                pos++;
                const content = cx.elt('InlineMathContent', start + 1, pos - 1);
                cx.addElement(cx.elt('InlineMath', start, pos, [content]));

                return pos + 1;
            },
        },
    ],
};

describe('headingExtraction', () => {
    const createView = (doc: string) => {
        const state = EditorState.create({
            doc,
            extensions: [
                markdown({
                    extensions: [GFM, inlineMathConfig],
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

    it('uses link label text and ignores the markdown-link URL destination', () => {
        const result = headingAt('# See [the docs](https://example.com)', 'docs');
        expect(result).toEqual({ text: 'See the docs', anchor: 'see-the-docs' });
    });

    it('keeps bare URLs / emails as visible heading text', () => {
        const result = headingAt('## 6. Resources `test` mailto:bwat47@gmail.com', 'Resources');
        expect(result).toEqual({
            text: '6. Resources test mailto:bwat47@gmail.com',
            anchor: '6-resources-test-mailtobwat47gmailcom',
        });
    });

    it('keeps autolink target text (without angle brackets)', () => {
        const result = headingAt('# Visit <https://example.com>', 'Visit');
        expect(result).toEqual({ text: 'Visit https://example.com', anchor: 'visit-httpsexamplecom' });
    });

    it('strips emphasis marks', () => {
        const result = headingAt('# **Bold** and *italic*', 'Bold');
        expect(result).toEqual({ text: 'Bold and italic', anchor: 'bold-and-italic' });
    });

    it('strips unsupported highlight (==) and insert (++) formatting', () => {
        const result = headingAt('# ==Important== ++new++', 'Important');
        expect(result).toEqual({ text: 'Important new', anchor: 'important-new' });
    });

    it('keeps inline math verbatim so anchors match Joplin heading links', () => {
        expect(headingAt('# Maxwell $E=mc^2$', 'Maxwell')).toEqual({
            text: 'Maxwell $E=mc^2$',
            anchor: 'maxwell-emc2',
        });

        expect(headingAt('## Decay of $\\alpha$ particles', 'Decay')).toEqual({
            text: 'Decay of $\\alpha$ particles',
            anchor: 'decay-of-alpha-particles',
        });

        // Lone dollar signs are not math and stay plain text.
        expect(headingAt('### Price is 5$ or 10$', 'Price')).toEqual({
            text: 'Price is 5$ or 10$',
            anchor: 'price-is-5-or-10',
        });
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
