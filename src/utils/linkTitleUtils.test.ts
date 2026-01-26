import { sanitizeLinkTitle, extractDomain, buildTitleAttributeToken } from './linkTitleUtils';

describe('linkTitleUtils', () => {
    describe('sanitizeLinkTitle', () => {
        it('removes square brackets from titles', () => {
            expect(sanitizeLinkTitle('Joplin [Docs]')).toBe('Joplin Docs');
        });
    });

    describe('extractDomain', () => {
        it('extracts domain without www prefix', () => {
            expect(extractDomain('https://www.joplinapp.org/path')).toBe('joplinapp.org');
        });
    });

    describe('buildTitleAttributeToken', () => {
        it('preserves double-quoted delimiter and escapes quotes', () => {
            expect(buildTitleAttributeToken('"Old"', 'New "Title"')).toBe('"New \\"Title\\""');
        });

        it('preserves single-quoted delimiter and escapes single quotes', () => {
            expect(buildTitleAttributeToken("'Old'", "O'Hara")).toBe("'O\\'Hara'");
        });

        it('preserves parenthesized delimiter and escapes closing parentheses', () => {
            expect(buildTitleAttributeToken('(Old)', 'Title)Here')).toBe('(Title\\)Here)');
        });
    });
});
