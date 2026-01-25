/**
 * Utilities for fetching and processing link titles from web pages.
 */

const FETCH_TIMEOUT_MS = 5000;

/**
 * Sanitizes a title for use in markdown link text.
 * Removes square brackets which would break markdown link syntax.
 */
export function sanitizeLinkTitle(title: string): string {
    return title.replace(/[\[\]]/g, '');
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

/**
 * Fetches the title of a web page.
 * Uses global fetch with timeout handling.
 *
 * @param url - The URL to fetch the title from
 * @returns Object with title (fetched or domain fallback) and whether it's a fallback
 */
export async function fetchLinkTitle(url: string): Promise<{ title: string; isFallback: boolean }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            redirect: 'follow',
            signal: controller.signal,
        });

        if (!response.ok) {
            return { title: extractDomain(url), isFallback: true };
        }

        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const rawTitle = doc.querySelector('title')?.textContent?.trim();

        if (!rawTitle) {
            return { title: extractDomain(url), isFallback: true };
        }

        return { title: sanitizeLinkTitle(rawTitle), isFallback: false };
    } catch {
        // Network error, timeout, or abort
        return { title: extractDomain(url), isFallback: true };
    } finally {
        clearTimeout(timeoutId);
    }
}
