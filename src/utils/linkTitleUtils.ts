/**
 * Utilities for fetching and processing link titles from web pages.
 */

import { logger } from '../logger';
import { LinkContext, LinkInfo, LinkType } from '../types';

const FETCH_TIMEOUT_MS = 5000;
const LINK_PREVIEW_API_URL = 'https://api.linkpreview.net/';

export interface FetchLinkTitleOptions {
    linkPreviewApiKey?: string;
    /** Raw JSON string of custom link title rules (see {@link LinkTitleRule}). */
    linkTitleRules?: string;
}

/**
 * A user-defined rule for deriving a link title directly from a URL,
 * without fetching the page. Rules are stored as a JSON array in settings.
 *
 * @example
 * // Extract the `track` query param value:
 * { pattern: 'helpdesk\\.example\\.com/.*[?&]track=([^&]+)', title: '$1' }
 */
export interface LinkTitleRule {
    /** Regex source, tested against the full URL. */
    pattern: string;
    /** Title template; `$1`..`$9` = capture groups, `$&` = the whole match. */
    title: string;
    /** Optional regex flags (e.g. `"i"` for case-insensitive). */
    flags?: string;
}

interface CompiledLinkTitleRule {
    regex: RegExp;
    title: string;
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

/**
 * Determines whether a link can have its title fetched and updated in place.
 *
 * Only external HTTP(S) URLs qualify: image embeds are not titled links, and
 * reference-style links lack the `expectedText`/markdown range needed to replace
 * them in place. Centralizes the rule shared by the context menu, the cursor
 * resolver, and the fetch handler.
 */
export function isFetchableLink(link: {
    type: LinkType;
    isImage?: boolean;
    isReferenceLink?: boolean;
    expectedText?: string;
}): boolean {
    return (
        link.type === LinkType.ExternalUrl &&
        !link.isImage &&
        !link.isReferenceLink &&
        typeof link.expectedText === 'string' &&
        link.expectedText.length > 0
    );
}

/**
 * Narrows a single cursor {@link LinkContext} to the {@link LinkInfo} shape
 * consumed by the unified fetch handler.
 */
export function linkContextToLinkInfo(ctx: LinkContext): LinkInfo {
    return {
        url: ctx.url,
        type: ctx.type,
        from: ctx.from,
        to: ctx.to,
        markdownLinkFrom: ctx.markdownLinkFrom,
        markdownLinkTo: ctx.markdownLinkTo,
        linkTitleToken: ctx.linkTitleToken,
        expectedText: ctx.expectedText,
    };
}

/**
 * Generates the menu label for the unified fetch link titles action.
 */
export function getFetchLinkTitlesMenuLabel(count: number): string {
    return count === 1 ? 'Fetch Link Title' : `Fetch Link Titles (${count})`;
}

/**
 * Single-entry cache for compiled rules. The rules string is a stable setting
 * value, so we compile once and reuse the result across every fetchLinkTitle
 * call (including once-per-link batch fetches). As a side benefit, warnings for
 * a malformed config are logged once per settings change rather than per link.
 */
let rulesCache: { raw: string; compiled: CompiledLinkTitleRule[] } | null = null;

/**
 * Parses, validates, and compiles the custom link title rules from their raw
 * JSON string form. Never throws: invalid JSON or invalid individual rules are
 * logged and skipped so a bad config can't break link fetching. Results are
 * memoized on the raw string, so repeated calls with the same config are cheap.
 *
 * @param json - Raw JSON string (a JSON array of {@link LinkTitleRule})
 * @returns Compiled rules in declaration order (may be empty)
 */
export function parseLinkTitleRules(json: string): CompiledLinkTitleRule[] {
    if (rulesCache && rulesCache.raw === json) {
        return rulesCache.compiled;
    }

    const compiled = compileLinkTitleRules(json);
    rulesCache = { raw: json, compiled };
    return compiled;
}

function compileLinkTitleRules(json: string): CompiledLinkTitleRule[] {
    if (!json || !json.trim()) {
        return [];
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch (error) {
        logger.warn('Ignoring custom link title rules: invalid JSON.', error);
        return [];
    }

    if (!Array.isArray(parsed)) {
        logger.warn('Ignoring custom link title rules: expected a JSON array.');
        return [];
    }

    const compiled: CompiledLinkTitleRule[] = [];
    for (const entry of parsed) {
        if (
            typeof entry !== 'object' ||
            entry === null ||
            typeof (entry as LinkTitleRule).pattern !== 'string' ||
            typeof (entry as LinkTitleRule).title !== 'string'
        ) {
            logger.warn('Skipping custom link title rule: missing string "pattern"/"title".', entry);
            continue;
        }

        const { pattern, title, flags } = entry as LinkTitleRule;
        if (flags !== undefined && typeof flags !== 'string') {
            logger.warn('Skipping custom link title rule: "flags" must be a string.', entry);
            continue;
        }

        try {
            compiled.push({ regex: new RegExp(pattern, flags ?? ''), title });
        } catch (error) {
            logger.warn(`Skipping custom link title rule with invalid regex: ${pattern}`, error);
        }
    }

    return compiled;
}

/**
 * Builds a title from a template by substituting capture-group placeholders
 * (`$1`..`$9` and `$&` for the whole match) from a regex match result.
 */
function applyTitleTemplate(template: string, match: RegExpExecArray): string {
    return template.replace(/\$(&|\d)/g, (_, token: string) => {
        if (token === '&') {
            return match[0];
        }
        return match[Number(token)] ?? '';
    });
}

/**
 * Applies the compiled rules to a URL, returning the title from the first rule
 * that matches, or null if none match.
 */
export function applyLinkTitleRules(url: string, rules: CompiledLinkTitleRule[]): string | null {
    for (const rule of rules) {
        // Cached regexes may carry lastIndex state from a prior URL when the
        // user supplied a g/y flag; reset so each URL is matched from the start.
        rule.regex.lastIndex = 0;
        const match = rule.regex.exec(url);
        if (!match) {
            continue;
        }

        const title = sanitizeLinkTitle(applyTitleTemplate(rule.title, match));
        if (title) {
            return title;
        }
    }

    return null;
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
    const rules = parseLinkTitleRules(options.linkTitleRules ?? '');
    const ruleTitle = applyLinkTitleRules(url, rules);
    if (ruleTitle) {
        return { title: ruleTitle, isFallback: false };
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
