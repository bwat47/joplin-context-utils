/**
 * Utilities for formatting Joplin markdown links to headings.
 *
 * Creates markdown links to a heading in either Joplin note-link format
 * (external) or local anchor-link format (internal). Kept in sync with the
 * joplin-heading-navigator plugin's link formatting:
 * https://github.com/bwat47/joplin-heading-navigator/blob/main/src/linkFormatting.ts
 *
 * @example
 * formatExternalHeadingLink('Introduction', 'My Note', 'abc123', 'introduction')
 * // => "[Introduction @ My Note](:/abc123#introduction)"
 *
 * formatInternalHeadingLink('Introduction', 'introduction')
 * // => "[Introduction](#introduction)"
 */

// Backslashes, brackets: required by Markdown syntax.
// HTML chars (<, >, &): prevents Joplin from rendering HTML tags in link text.
export function escapeLinkText(text: string): string {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/&/g, '\\&')
        .replace(/</g, '\\<')
        .replace(/>/g, '\\>')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]');
}

export function formatExternalHeadingLink(
    headingText: string,
    noteTitle: string,
    noteId: string,
    headingAnchor: string
): string {
    const label = `${escapeLinkText(headingText)} @ ${escapeLinkText(noteTitle)}`;
    const target = `:/${noteId}#${headingAnchor}`;
    return `[${label}](${target})`;
}

export function formatInternalHeadingLink(headingText: string, headingAnchor: string): string {
    const label = escapeLinkText(headingText);
    return `[${label}](#${headingAnchor})`;
}
