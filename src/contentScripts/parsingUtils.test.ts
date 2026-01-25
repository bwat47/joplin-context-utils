/* eslint-disable @typescript-eslint/no-explicit-any */
import {
    classifyUrl,
    parseImageTag,
    parseInlineCode,
    extractReferenceLabel,
    findReferenceDefinition,
    findFootnoteDefinition,
    extractUrl,
} from './parsingUtils';
import { LinkType } from '../types';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';

describe('parsingUtils', () => {
    describe('classifyUrl', () => {
        it('should identify external HTTP URLs', () => {
            expect(classifyUrl('http://example.com')).toEqual({
                url: 'http://example.com',
                type: LinkType.ExternalUrl,
            });
        });

        it('should identify external HTTPS URLs', () => {
            expect(classifyUrl('https://example.com/path?query=1')).toEqual({
                url: 'https://example.com/path?query=1',
                type: LinkType.ExternalUrl,
            });
        });

        it('should identify Joplin resources', () => {
            const resourceId = ':/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
            expect(classifyUrl(resourceId)).toEqual({
                url: resourceId,
                type: LinkType.JoplinResource,
            });
        });

        it('should identify Joplin resources with hash', () => {
            const resourceId = ':/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4#page=1';
            expect(classifyUrl(resourceId)).toEqual({
                url: resourceId,
                type: LinkType.JoplinResource,
            });
        });

        it('should identify mailto links', () => {
            expect(classifyUrl('mailto:user@example.com')).toEqual({
                url: 'mailto:user@example.com',
                type: LinkType.Email,
            });
        });

        it('should return null for invalid URLs', () => {
            expect(classifyUrl('invalid-url')).toBeNull();
            expect(classifyUrl('/local/path')).toBeNull();
        });
    });

    describe('parseImageTag', () => {
        it('should extract src from double-quoted attributes', () => {
            const html = '<img src="https://example.com/image.png" alt="test">';
            expect(parseImageTag(html)).toEqual({
                url: 'https://example.com/image.png',
                type: LinkType.ExternalUrl,
            });
        });

        it('should extract src from single-quoted attributes', () => {
            const html = "<img src='https://example.com/image.png' />";
            expect(parseImageTag(html)).toEqual({
                url: 'https://example.com/image.png',
                type: LinkType.ExternalUrl,
            });
        });

        it('should handle Joplin resource IDs in src', () => {
            const html = '<img src=":/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4" />';
            expect(parseImageTag(html)).toEqual({
                url: ':/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
                type: LinkType.JoplinResource,
            });
        });

        it('should return null for non-img tags', () => {
            expect(parseImageTag('<div>not an image</div>')).toBeNull();
        });

        it('should return null for img tags without src', () => {
            expect(parseImageTag('<img alt="broken" />')).toBeNull();
        });
    });

    describe('parseInlineCode', () => {
        it('should extract content from backticks', () => {
            expect(parseInlineCode('`const x = 1`')).toEqual({
                code: 'const x = 1',
            });
        });

        it('should return null for text without backticks', () => {
            expect(parseInlineCode('plain text')).toBeNull();
        });

        it('should return null for malformed backticks', () => {
            // The regex expects start and end backticks for the whole string
            expect(parseInlineCode('`unclosed')).toBeNull();
        });
    });

    describe('Reference Links', () => {
        const createView = (doc: string) => {
            const state = EditorState.create({
                doc,
                extensions: [markdown()],
            });
            // Mock EditorView since we only need state
            return { state } as any;
        };

        describe('extractUrl', () => {
            it('should extract URL and title attribute from markdown links', () => {
                const text = '[Joplin](https://joplinapp.org "Joplin [Docs]")';
                const { state } = createView(text);
                const tree = syntaxTree(state);
                let extracted = null;

                tree.iterate({
                    enter: (node) => {
                        if (node.name === 'Link') {
                            extracted = extractUrl(node.node, { state } as any);
                        }
                    },
                });

                expect(extracted).toEqual({
                    url: 'https://joplinapp.org',
                    from: text.indexOf('https://joplinapp.org'),
                    to: text.indexOf('https://joplinapp.org') + 'https://joplinapp.org'.length,
                    linkTitleToken: '"Joplin [Docs]"',
                });
            });

            it('should preserve single-quoted title tokens', () => {
                const text = "[Joplin](https://joplinapp.org 'Docs Title')";
                const { state } = createView(text);
                const tree = syntaxTree(state);
                let extracted = null;

                tree.iterate({
                    enter: (node) => {
                        if (node.name === 'Link') {
                            extracted = extractUrl(node.node, { state } as any);
                        }
                    },
                });

                expect(extracted).toEqual({
                    url: 'https://joplinapp.org',
                    from: text.indexOf('https://joplinapp.org'),
                    to: text.indexOf('https://joplinapp.org') + 'https://joplinapp.org'.length,
                    linkTitleToken: "'Docs Title'",
                });
            });

            it('should preserve parenthesized title tokens', () => {
                const text = '[Joplin](https://joplinapp.org (Docs Title))';
                const { state } = createView(text);
                const tree = syntaxTree(state);
                let extracted = null;

                tree.iterate({
                    enter: (node) => {
                        if (node.name === 'Link') {
                            extracted = extractUrl(node.node, { state } as any);
                        }
                    },
                });

                expect(extracted).toEqual({
                    url: 'https://joplinapp.org',
                    from: text.indexOf('https://joplinapp.org'),
                    to: text.indexOf('https://joplinapp.org') + 'https://joplinapp.org'.length,
                    linkTitleToken: '(Docs Title)',
                });
            });
        });

        describe('extractReferenceLabel', () => {
            it('should extract label from reference link', () => {
                const text = '[Google][2]';
                const { state } = createView(text);
                const tree = syntaxTree(state);
                let label = null;

                tree.iterate({
                    enter: (node) => {
                        if (node.name === 'Link') {
                            label = extractReferenceLabel(node.node, { state } as any);
                        }
                    },
                });

                expect(label).toBe('[2]');
            });

            it('should return null for normal links', () => {
                const text = '[Google](https://google.com)';
                const { state } = createView(text);
                const tree = syntaxTree(state);
                let label = null;

                tree.iterate({
                    enter: (node) => {
                        if (node.name === 'Link') {
                            label = extractReferenceLabel(node.node, { state } as any);
                        }
                    },
                });

                expect(label).toBeNull();
            });

            it('should return null for shortcut reference links', () => {
                const text = '[Google]\n\n[Google]: https://google.com';
                const { state } = createView(text);
                const tree = syntaxTree(state);
                let label = null;

                tree.iterate({
                    enter: (node) => {
                        if (node.name === 'Link') {
                            label = extractReferenceLabel(node.node, { state } as any);
                        }
                    },
                });

                // Shortcut links have no explicit label, should return null
                expect(label).toBeNull();
            });

            it('should return "[]" for collapsed reference links', () => {
                const text = '[Google][]\n\n[Google]: https://google.com';
                const { state } = createView(text);
                const tree = syntaxTree(state);
                let label = null;

                tree.iterate({
                    enter: (node) => {
                        if (node.name === 'Link') {
                            label = extractReferenceLabel(node.node, { state } as any);
                        }
                    },
                });

                // Collapsed links have empty label "[]"
                expect(label).toBe('[]');
            });
        });

        describe('findReferenceDefinition', () => {
            it('should find definition for label', () => {
                const text = '[Google][2]\n\n[2]: https://google.com';
                const { state } = createView(text);
                const url = findReferenceDefinition({ state } as any, '[2]');
                expect(url).toBe('https://google.com');
            });

            it('should return null if definition not found', () => {
                const text = '[Google][2]';
                const { state } = createView(text);
                const url = findReferenceDefinition({ state } as any, '[2]');
                expect(url).toBeNull();
            });

            it('should handle title in definition', () => {
                const text = '[2]: https://google.com "Title"';
                const { state } = createView(text);
                const url = findReferenceDefinition({ state } as any, '[2]');
                expect(url).toBe('https://google.com');
            });

            it('should use first occurrence when multiple definitions exist with same label', () => {
                const text =
                    '[Example][1]\n\n' +
                    '[1]: https://first.com\n' +
                    '[1]: https://second.com\n' +
                    '[1]: https://third.com';
                const { state } = createView(text);
                const url = findReferenceDefinition({ state } as any, '[1]');
                expect(url).toBe('https://first.com');
            });

            it('should match labels case-insensitively', () => {
                const text = '[upper]: https://example.com/case-insensitive';
                const { state } = createView(text);

                // All of these should match the [upper] definition
                expect(findReferenceDefinition({ state } as any, '[upper]')).toBe(
                    'https://example.com/case-insensitive'
                );
                expect(findReferenceDefinition({ state } as any, '[UPPER]')).toBe(
                    'https://example.com/case-insensitive'
                );
                expect(findReferenceDefinition({ state } as any, '[UpPeR]')).toBe(
                    'https://example.com/case-insensitive'
                );
                expect(findReferenceDefinition({ state } as any, '[Upper]')).toBe(
                    'https://example.com/case-insensitive'
                );
            });

            it('should find definition for shortcut reference link', () => {
                const text = '[Google]\n\n[Google]: https://google.com';
                const { state } = createView(text);
                // For shortcut links [foo], the label is the link text itself
                const url = findReferenceDefinition({ state } as any, '[Google]');
                expect(url).toBe('https://google.com');
            });

            it('should find definition for collapsed reference link', () => {
                const text = '[Google][]\n\n[Google]: https://google.com';
                const { state } = createView(text);
                // For collapsed links [foo][], the label should be the link text
                const url = findReferenceDefinition({ state } as any, '[Google]');
                expect(url).toBe('https://google.com');
            });
        });

        describe('findFootnoteDefinition', () => {
            it('should find footnote definition', () => {
                const text = 'Some text[^1] here.\n\n[^1]: This is the footnote.';
                const { state } = createView(text);
                const pos = findFootnoteDefinition({ state } as any, '1');
                expect(pos).toBe(text.indexOf('[^1]:'));
            });

            it('should return null if definition not found', () => {
                const text = 'Some text[^1] here.\n\nNo definition.';
                const { state } = createView(text);
                const pos = findFootnoteDefinition({ state } as any, '1');
                expect(pos).toBeNull();
            });

            it('should match labels case-insensitively', () => {
                const text = 'Reference[^Note] here.\n\n[^note]: Definition text.';
                const { state } = createView(text);

                // All case variations should find the same definition
                expect(findFootnoteDefinition({ state } as any, 'Note')).toBe(text.indexOf('[^note]:'));
                expect(findFootnoteDefinition({ state } as any, 'NOTE')).toBe(text.indexOf('[^note]:'));
                expect(findFootnoteDefinition({ state } as any, 'note')).toBe(text.indexOf('[^note]:'));
                expect(findFootnoteDefinition({ state } as any, 'NoTe')).toBe(text.indexOf('[^note]:'));
            });

            it('should handle footnotes with complex labels', () => {
                const text = 'Text[^my-note-1] here.\n\n[^my-note-1]: Complex label footnote.';
                const { state } = createView(text);
                const pos = findFootnoteDefinition({ state } as any, 'my-note-1');
                expect(pos).toBe(text.indexOf('[^my-note-1]:'));
            });

            it('should skip footnote definitions inside code blocks', () => {
                const text =
                    'Reference[^1] here.\n\n' +
                    '```\n' +
                    '[^1]: This is inside a code block\n' +
                    '```\n\n' +
                    '[^1]: This is the real footnote definition.';
                const { state } = createView(text);
                const pos = findFootnoteDefinition({ state } as any, '1');
                // Should find the definition AFTER the code block, not inside it
                expect(pos).toBe(text.lastIndexOf('[^1]:'));
            });

            it('should return null if only match is inside code block', () => {
                const text = 'Reference[^1] here.\n\n' + '```\n' + '[^1]: This is inside a code block\n' + '```';
                const { state } = createView(text);
                const pos = findFootnoteDefinition({ state } as any, '1');
                expect(pos).toBeNull();
            });
        });
    });
});
