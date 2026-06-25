import {
    sanitizeLinkTitle,
    escapeMarkdownLinkText,
    extractDomain,
    buildTitleAttributeToken,
    fetchLinkTitle,
    parseLinkTitleRules,
    applyLinkTitleRules,
} from './linkTitleUtils';

const mockFetch = jest.fn();

// Mirrors the seeded `linkTitleRules` default value in src/settings.ts.
const DEFAULT_JIRA_RULES = JSON.stringify([
    {
        pattern: '^https?://([a-z0-9-]+\\.)*atlassian\\.net/(?:browse|issues)/([A-Z][A-Z0-9]+-\\d+)',
        title: '$2',
        flags: 'i',
    },
    {
        pattern: '^https?://([a-z0-9-]+\\.)*atlassian\\.net/issues.*[?&]selectedIssue=([A-Za-z][A-Za-z0-9]+-\\d+)',
        title: '$2',
        flags: 'i',
    },
]);

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

        it('applies the seeded Jira rule ahead of provider lookup', async () => {
            const result = await fetchLinkTitle('https://team.atlassian.net/browse/PROJ-123', {
                linkPreviewApiKey: 'test-key',
                linkTitleRules: DEFAULT_JIRA_RULES,
            });

            expect(result).toEqual({ title: 'PROJ-123', isFallback: false });
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('does not apply the Jira rule when atlassian.net only appears in a query param of another host', async () => {
            mockFetch.mockResolvedValueOnce(
                createTextResponse(true, '<html><head><title>Direct Title</title></head><body></body></html>')
            );

            const result = await fetchLinkTitle('https://example.com/?redirect=team.atlassian.net/browse/PROJ-123', {
                linkTitleRules: DEFAULT_JIRA_RULES,
            });

            expect(result).toEqual({ title: 'Direct Title', isFallback: false });
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('applies a custom query-param rule ahead of any fetch', async () => {
            const rules = JSON.stringify([{ pattern: 'helpdesk\\.example\\.com/.*[?&]track=([^&]+)', title: '$1' }]);

            const result = await fetchLinkTitle('https://helpdesk.example.com/ticket.php?track=7QF-MZP-9KD2', {
                linkTitleRules: rules,
            });

            expect(result).toEqual({ title: '7QF-MZP-9KD2', isFallback: false });
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('falls through to fetching when no rule matches', async () => {
            mockFetch.mockResolvedValueOnce(
                createTextResponse(true, '<html><head><title>Direct Title</title></head><body></body></html>')
            );

            const result = await fetchLinkTitle('https://example.com/docs', {
                linkTitleRules: DEFAULT_JIRA_RULES,
            });

            expect(result).toEqual({ title: 'Direct Title', isFallback: false });
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('ignores invalid rule JSON and proceeds with fetching', async () => {
            mockFetch.mockResolvedValueOnce(
                createTextResponse(true, '<html><head><title>Direct Title</title></head><body></body></html>')
            );

            const result = await fetchLinkTitle('https://example.com/docs', {
                linkTitleRules: 'not json',
            });

            expect(result).toEqual({ title: 'Direct Title', isFallback: false });
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });
    });

    describe('parseLinkTitleRules', () => {
        it('returns an empty array for blank input', () => {
            expect(parseLinkTitleRules('')).toEqual([]);
            expect(parseLinkTitleRules('   ')).toEqual([]);
        });

        it('returns an empty array for invalid JSON', () => {
            expect(parseLinkTitleRules('{not json')).toEqual([]);
        });

        it('returns an empty array when the JSON is not an array', () => {
            expect(parseLinkTitleRules('{"pattern":"x","title":"y"}')).toEqual([]);
        });

        it('skips entries missing string pattern/title', () => {
            const rules = parseLinkTitleRules(
                JSON.stringify([
                    { pattern: 'good', title: '$&' },
                    { pattern: 123, title: 'x' },
                    { title: 'no pattern' },
                ])
            );
            expect(rules).toHaveLength(1);
        });

        it('skips entries with an invalid regex but keeps valid ones', () => {
            const rules = parseLinkTitleRules(
                JSON.stringify([
                    { pattern: '(', title: 'broken' },
                    { pattern: 'example', title: 'ok' },
                ])
            );
            expect(rules).toHaveLength(1);
            expect(applyLinkTitleRules('https://example.com', rules)).toBe('ok');
        });
    });

    describe('applyLinkTitleRules', () => {
        it('substitutes numbered capture groups and the whole match', () => {
            const rules = parseLinkTitleRules(JSON.stringify([{ pattern: 'id=(\\d+)-(\\w+)', title: '$2 ($1)' }]));
            expect(applyLinkTitleRules('https://x.com/?id=42-abc', rules)).toBe('abc (42)');

            const wholeMatch = parseLinkTitleRules(JSON.stringify([{ pattern: 'PROJ-\\d+', title: '$&' }]));
            expect(applyLinkTitleRules('https://x.com/PROJ-7', wholeMatch)).toBe('PROJ-7');
        });

        it('returns the first matching rule in declaration order', () => {
            const rules = parseLinkTitleRules(
                JSON.stringify([
                    { pattern: 'example\\.com', title: 'first' },
                    { pattern: 'example', title: 'second' },
                ])
            );
            expect(applyLinkTitleRules('https://example.com', rules)).toBe('first');
        });

        it('skips a rule whose template resolves to an empty title', () => {
            const rules = parseLinkTitleRules(
                JSON.stringify([
                    { pattern: 'example\\.com(/empty)?', title: '$1' },
                    { pattern: 'example', title: 'fallback' },
                ])
            );
            expect(applyLinkTitleRules('https://example.com', rules)).toBe('fallback');
        });

        it('returns null when nothing matches', () => {
            const rules = parseLinkTitleRules(JSON.stringify([{ pattern: 'nope', title: 'x' }]));
            expect(applyLinkTitleRules('https://example.com', rules)).toBeNull();
        });
    });
});
