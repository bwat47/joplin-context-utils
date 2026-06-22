import { EditorContext, LinkType } from '../types';
import { resolveContextualCopyTarget } from './contextualCopyResolver';

describe('resolveContextualCopyTarget', () => {
    const code = (codeText = 'render'): EditorContext => ({
        contextType: 'code',
        code: codeText,
        from: 5,
        to: 13,
    });

    const heading = (): EditorContext => ({
        contextType: 'heading',
        headingText: 'Use render here',
        headingAnchor: 'use-render-here',
        from: 0,
        to: 18,
    });

    const quote = (): EditorContext => ({
        contextType: 'quote',
        quoteText: 'Use `render` here',
        from: 0,
        to: 20,
    });

    const link = (type = LinkType.ExternalUrl): EditorContext => ({
        contextType: 'link',
        type,
        url: type === LinkType.Email ? 'mailto:test@example.com' : 'https://joplinapp.org',
        from: 8,
        to: 28,
    });

    it('chooses code inside a heading', () => {
        const target = resolveContextualCopyTarget([code(), heading()]);

        expect(target?.kind).toBe('code');
    });

    it('chooses code inside a quote', () => {
        const target = resolveContextualCopyTarget([code(), quote()]);

        expect(target?.kind).toBe('code');
    });

    it('chooses link inside a quote', () => {
        const target = resolveContextualCopyTarget([link(), quote()]);

        expect(target?.kind).toBe('link');
    });

    it('chooses heading inside a quote', () => {
        const target = resolveContextualCopyTarget([heading(), quote()]);

        expect(target?.kind).toBe('heading');
    });

    it('chooses quote when it is the only copy target', () => {
        const target = resolveContextualCopyTarget([quote()]);

        expect(target?.kind).toBe('quote');
    });

    it('ignores task and footnote contexts', () => {
        const contexts: EditorContext[] = [
            {
                contextType: 'task',
                tasks: [{ lineText: '- [ ] Task', checked: false, from: 0, to: 10 }],
                checkedCount: 0,
                uncheckedCount: 1,
            },
            {
                contextType: 'footnote',
                label: '1',
                targetPos: 20,
                from: 4,
                to: 8,
            },
        ];

        expect(resolveContextualCopyTarget(contexts)).toBeNull();
    });

    it('allows external URL and email links', () => {
        expect(resolveContextualCopyTarget([link(LinkType.ExternalUrl)])?.kind).toBe('link');
        expect(resolveContextualCopyTarget([link(LinkType.Email)])?.kind).toBe('link');
    });

    it('ignores internal anchor and Joplin resource links', () => {
        expect(resolveContextualCopyTarget([link(LinkType.InternalAnchor)])).toBeNull();
        expect(resolveContextualCopyTarget([link(LinkType.JoplinResource)])).toBeNull();
    });
});
