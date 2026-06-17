import { escapeLinkText, formatInternalHeadingLink, formatExternalHeadingLink } from './headingLinkFormatting';

describe('headingLinkFormatting', () => {
    describe('escapeLinkText', () => {
        it('escapes markdown and HTML-sensitive characters', () => {
            expect(escapeLinkText('a [b] <c> & d \\e')).toBe('a \\[b\\] \\<c\\> \\& d \\\\e');
        });

        it('leaves plain text untouched', () => {
            expect(escapeLinkText('Plain Heading')).toBe('Plain Heading');
        });
    });

    describe('formatInternalHeadingLink', () => {
        it('formats an internal anchor link', () => {
            expect(formatInternalHeadingLink('Introduction', 'introduction')).toBe('[Introduction](#introduction)');
        });

        it('escapes the link text', () => {
            expect(formatInternalHeadingLink('Notes [draft]', 'notes-draft')).toBe('[Notes \\[draft\\]](#notes-draft)');
        });
    });

    describe('formatExternalHeadingLink', () => {
        it('formats an external Joplin note link with heading anchor', () => {
            expect(formatExternalHeadingLink('Introduction', 'My Note', 'abc123', 'introduction')).toBe(
                '[Introduction @ My Note](:/abc123#introduction)'
            );
        });

        it('escapes both heading text and note title', () => {
            expect(formatExternalHeadingLink('A [x]', 'Note <b>', 'id1', 'a-x')).toBe(
                '[A \\[x\\] @ Note \\<b\\>](:/id1#a-x)'
            );
        });
    });
});
