/**
 * Utilities for fetching and processing link titles from web pages.
 */

const FETCH_TIMEOUT_MS = 5000;
const JIRA_ISSUE_KEY_REGEX = /\/(?:browse|issues)\/([A-Z][A-Z0-9]+-\d+)(?:\/|$)/i;
const LINK_PREVIEW_API_URL = 'https://api.linkpreview.net/';

export interface FetchLinkTitleOptions {
    linkPreviewApiKey?: string;
}

/**
 * Sanitizes a title for use in markdown link text.
 * Removes square brackets and collapses line breaks which would break markdown link syntax.
 */
export function sanitizeLinkTitle(title: string): string {
    return title
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .replace(/[\[\]]/g, '')
        .trim();
}

/**
 * Escapes characters in markdown link text that would break surrounding syntax.
 */
export function escapeMarkdownLinkText(title: string): string {
    return title.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

function extractJiraIssueKey(url: string): string | null {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();

        if (hostname !== 'atlassian.net' && !hostname.endsWith('.atlassian.net')) {
            return null;
        }

        const match = parsed.pathname.match(JIRA_ISSUE_KEY_REGEX);
        if (!match) {
            if (parsed.pathname.startsWith('/issues')) {
                const selectedIssue = parsed.searchParams.get('selectedIssue');
                if (selectedIssue) {
                    return selectedIssue.toUpperCase();
                }
            }
            return null;
        }

        return match[1].toUpperCase();
    } catch {
        return null;
    }
}

function escapeTitleForDelimiter(value: string, delimiter: '"' | "'" | '('): string {
    if (!value) return '';
    const escaped = String(value).replace(/\\/g, '\\\\');
    if (delimiter === '"') {
        // Only escape quotes that would terminate the title string
        return escaped.replace(/"/g, '\\"');
    }
    if (delimiter === "'") {
        return escaped.replace(/'/g, "\\'");
    }
    return escaped.replace(/\)/g, '\\)');
}

/**
 * Builds a replacement title attribute token using the existing delimiter style.
 *
 * @param existingToken - Raw title token, including delimiters
 * @param title - Title text to place in the token
 */
export function buildTitleAttributeToken(existingToken: string, title: string): string {
    const trimmed = existingToken.trim();
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];

    if (first === '"' && last === '"') {
        return `"${escapeTitleForDelimiter(title, '"')}"`;
    }
    if (first === "'" && last === "'") {
        return `'${escapeTitleForDelimiter(title, "'")}'`;
    }
    if (first === '(' && last === ')') {
        return `(${escapeTitleForDelimiter(title, '(')})`;
    }

    return `"${escapeTitleForDelimiter(title, '"')}"`;
}

/**
 * Extracts the domain name from a URL for use as a fallback title.
 * @example "https://www.example.com/path" → "example.com"
 */
export function extractDomain(url: string): string {
    try {
        const hostname = new URL(url).hostname;
        // Remove 'www.' prefix if present
        return hostname.replace(/^www\./, '');
    } catch {
        return url; // Return original URL if parsing fails
    }
}

async function fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        return await fetch(input, {
            ...init,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchTitleViaLinkPreview(url: string, apiKey: string): Promise<string | null> {
    const response = await fetchWithTimeout(`${LINK_PREVIEW_API_URL}?q=${encodeURIComponent(url)}`, {
        headers: {
            'X-Linkpreview-Api-Key': apiKey,
        },
    });

    if (!response.ok) {
        return null;
    }

    const data = (await response.json()) as { title?: unknown } | null;
    const rawTitle = typeof data?.title === 'string' ? data.title.trim() : '';

    if (!rawTitle) {
        return null;
    }

    return sanitizeLinkTitle(rawTitle);
}

async function fetchTitleDirectly(url: string): Promise<string | null> {
    const response = await fetchWithTimeout(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        redirect: 'follow',
    });

    if (!response.ok) {
        return null;
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rawTitle = doc.querySelector('title')?.textContent?.trim();

    if (!rawTitle) {
        return null;
    }

    return sanitizeLinkTitle(rawTitle);
}

/**
 * Fetches the title of a web page.
 * Uses global fetch with timeout handling.
 *
 * @param url - The URL to fetch the title from
 * @returns Object with title (fetched or domain fallback) and whether it's a fallback
 */
export async function fetchLinkTitle(
    url: string,
    options: FetchLinkTitleOptions = {}
): Promise<{ title: string; isFallback: boolean }> {
    const jiraIssueKey = extractJiraIssueKey(url);
    if (jiraIssueKey) {
        return { title: jiraIssueKey, isFallback: false };
    }

    const linkPreviewApiKey = options.linkPreviewApiKey?.trim();
    if (linkPreviewApiKey) {
        try {
            const linkPreviewTitle = await fetchTitleViaLinkPreview(url, linkPreviewApiKey);
            if (linkPreviewTitle) {
                return { title: linkPreviewTitle, isFallback: false };
            }
        } catch {
            // Fall through to direct fetch if the provider request fails.
        }
    }

    try {
        const directTitle = await fetchTitleDirectly(url);
        if (directTitle) {
            return { title: directTitle, isFallback: false };
        }
    } catch {
        // Network error, timeout, malformed response, or abort
    }

    return { title: extractDomain(url), isFallback: true };
}
