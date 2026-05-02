import {
    sanitizeLinkTitle,
    escapeMarkdownLinkText,
    extractDomain,
    buildTitleAttributeToken,
    fetchLinkTitle,
} from './linkTitleUtils';

const mockFetch = jest.fn();

function createJsonResponse(ok: boolean, data: unknown): Response {
    return {
        ok,
        json: jest.fn().mockResolvedValue(data),
    } as unknown as Response;
}

function createTextResponse(ok: boolean, html: string): Response {
    return {
        ok,
        text: jest.fn().mockResolvedValue(html),
    } as unknown as Response;
}

describe('linkTitleUtils', () => {
    beforeEach(() => {
        mockFetch.mockReset();
        global.fetch = mockFetch as unknown as typeof fetch;
    });

    describe('sanitizeLinkTitle', () => {
        it('removes square brackets from titles', () => {
            expect(sanitizeLinkTitle('Joplin [Docs]')).toBe('Joplin Docs');
        });

        it('replaces line breaks with spaces', () => {
            expect(sanitizeLinkTitle('Joplin\nDocs\r\nGuide')).toBe('Joplin Docs Guide');
        });
    });

    describe('escapeMarkdownLinkText', () => {
        it('escapes pipes used in markdown tables', () => {
            expect(escapeMarkdownLinkText('Docs | API')).toBe('Docs \\| API');
        });

        it('escapes backslashes so literal backslashes survive markdown parsing', () => {
            expect(escapeMarkdownLinkText('Path\\To\\Docs')).toBe('Path\\\\To\\\\Docs');
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

        it('escapes backslashes for double-quoted titles', () => {
            expect(buildTitleAttributeToken('"Old"', 'Path\\To\\File')).toBe('"Path\\\\To\\\\File"');
        });

        it('preserves single-quoted delimiter and escapes single quotes', () => {
            expect(buildTitleAttributeToken("'Old'", "O'Hara")).toBe("'O\\'Hara'");
        });

        it('escapes backslashes for single-quoted titles', () => {
            expect(buildTitleAttributeToken("'Old'", 'Path\\To\\File')).toBe("'Path\\\\To\\\\File'");
        });

        it('preserves parenthesized delimiter and escapes closing parentheses', () => {
            expect(buildTitleAttributeToken('(Old)', 'Title)Here')).toBe('(Title\\)Here)');
        });

        it('escapes backslashes for parenthesized titles', () => {
            expect(buildTitleAttributeToken('(Old)', 'Path\\To\\File')).toBe('(Path\\\\To\\\\File)');
        });
    });

    describe('fetchLinkTitle', () => {
        it('uses linkpreview.net when an API key is present', async () => {
            mockFetch.mockResolvedValueOnce(createJsonResponse(true, { title: 'Docs [API]\nGuide' }));

            const result = await fetchLinkTitle('https://example.com/docs', {
                linkPreviewApiKey: 'test-key',
            });

            expect(result).toEqual({ title: 'Docs API Guide', isFallback: false });
            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.linkpreview.net/?q=https%3A%2F%2Fexample.com%2Fdocs',
                expect.objectContaining({
                    headers: {
                        'X-Linkpreview-Api-Key': 'test-key',
                    },
                })
            );
        });

        it('falls back to direct HTML fetch when linkpreview.net returns an HTTP error', async () => {
            mockFetch
                .mockResolvedValueOnce(createJsonResponse(false, { error: 'bad key' }))
                .mockResolvedValueOnce(
                    createTextResponse(true, '<html><head><title>Example Title</title></head></html>')
                );

            const result = await fetchLinkTitle('https://example.com/docs', {
                linkPreviewApiKey: 'test-key',
            });

            expect(result).toEqual({ title: 'Example Title', isFallback: false });
            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(mockFetch).toHaveBeenNthCalledWith(
                2,
                'https://example.com/docs',
                expect.objectContaining({
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    redirect: 'follow',
                })
            );
        });

        it('falls back to direct HTML fetch when linkpreview.net returns a blank title', async () => {
            mockFetch
                .mockResolvedValueOnce(createJsonResponse(true, { title: '   ' }))
                .mockResolvedValueOnce(
                    createTextResponse(true, '<html><head><title>Fallback Title</title></head><body></body></html>')
                );

            const result = await fetchLinkTitle('https://example.com/docs', {
                linkPreviewApiKey: 'test-key',
            });

            expect(result).toEqual({ title: 'Fallback Title', isFallback: false });
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        it('falls back to the domain when both provider and direct fetch fail', async () => {
            mockFetch
                .mockRejectedValueOnce(new Error('provider failed'))
                .mockRejectedValueOnce(new Error('direct failed'));

            const result = await fetchLinkTitle('https://www.example.com/docs', {
                linkPreviewApiKey: 'test-key',
            });

            expect(result).toEqual({ title: 'example.com', isFallback: true });
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        it('skips linkpreview.net when the API key is blank', async () => {
            mockFetch.mockResolvedValueOnce(
                createTextResponse(true, '<html><head><title>Direct Title</title></head><body></body></html>')
            );

            const result = await fetchLinkTitle('https://example.com/docs', {
                linkPreviewApiKey: '   ',
            });

            expect(result).toEqual({ title: 'Direct Title', isFallback: false });
            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(mockFetch).toHaveBeenCalledWith(
                'https://example.com/docs',
                expect.objectContaining({
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    redirect: 'follow',
                })
            );
        });

        it('preserves Jira special handling ahead of provider lookup', async () => {
            const result = await fetchLinkTitle('https://team.atlassian.net/browse/PROJ-123', {
                linkPreviewApiKey: 'test-key',
            });

            expect(result).toEqual({ title: 'PROJ-123', isFallback: false });
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });
});
