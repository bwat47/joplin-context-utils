/* eslint-disable @typescript-eslint/no-explicit-any */
import {
    classifyUrl,
    parseImageTag,
    parseInlineCode,
    extractReferenceLabel,
    findReferenceDefinition,
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
        });
    });
});
