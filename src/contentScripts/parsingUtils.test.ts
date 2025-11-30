import { classifyUrl, parseImageTag, parseInlineCode } from './parsingUtils';
import { LinkType } from '../types';

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
});
