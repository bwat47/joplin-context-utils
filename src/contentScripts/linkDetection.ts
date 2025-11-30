import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { LinkContext, LinkType, MESSAGE_TYPES } from '../types';
import type { ContentScriptContext, CodeMirrorWrapper } from '../types';

/**
 * Detects link at cursor position using CodeMirror 6 syntax tree
 *
 * @param view - CodeMirror 6 EditorView instance
 * @param pos - Cursor position to check
 * @returns LinkContext if link found, null otherwise
 */
function detectLinkAtPosition(view: EditorView, pos: number): LinkContext | null {
    const tree = syntaxTree(view.state);
    let linkContext: LinkContext | null = null;

    // Traverse syntax tree to find link nodes at position
    tree.iterate({
        from: pos,
        to: pos,
        enter: (node) => {
            const { type, from, to } = node;

            // Check for different link node types from @lezer/markdown
            if (type.name === 'Link' || type.name === 'URL' || type.name === 'Autolink') {
                const linkText = view.state.doc.sliceString(from, to);
                const parsedLink = parseLink(linkText, type.name);

                if (parsedLink) {
                    linkContext = {
                        ...parsedLink,
                        from,
                        to,
                    };
                    return false; // Stop iteration
                }
            }
            // Check for HTML tags (img elements)
            else if (type.name === 'HTMLTag') {
                const htmlText = view.state.doc.sliceString(from, to);
                const parsedImage = parseImageTag(htmlText);

                if (parsedImage) {
                    linkContext = {
                        ...parsedImage,
                        from,
                        to,
                    };
                    return false; // Stop iteration
                }
            }
        },
    });

    return linkContext;
}

/**
 * Parses link text and determines link type
 * Handles both markdown syntax [text](url) and bare URLs
 */
function parseLink(linkText: string, nodeType: string): Omit<LinkContext, 'from' | 'to'> | null {
    let url: string;

    // Extract URL from markdown link syntax
    if (nodeType === 'Link') {
        // Match [text](url) pattern
        const match = linkText.match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (!match) return null;
        url = match[2];
    } else {
        // For Autolink and bare URL, the text IS the URL
        // Remove angle brackets if present (<url>)
        url = linkText.replace(/^<|>$/g, '');
    }

    return classifyUrl(url);
}

/**
 * Parses HTML img tag and extracts src attribute
 * Handles img elements with various attributes
 */
function parseImageTag(htmlText: string): Omit<LinkContext, 'from' | 'to'> | null {
    // Check if this is an img tag
    if (!htmlText.match(/<img\s/i)) {
        return null;
    }

    // Extract src attribute value
    const srcMatch = htmlText.match(/\ssrc=["']([^"']+)["']/i);
    if (!srcMatch) {
        return null;
    }

    const url = srcMatch[1];
    return classifyUrl(url);
}

/**
 * Classifies a URL and determines its type
 * @param url - The URL to classify
 * @returns Link context with type, or null if not a supported URL type
 */
function classifyUrl(url: string): Omit<LinkContext, 'from' | 'to'> | null {
    // Determine link type
    if (url.match(/^:\/[a-f0-9]{32}$/i)) {
        return { url, type: LinkType.JoplinResource };
    } else if (url.match(/^https?:\/\//)) {
        return { url, type: LinkType.ExternalUrl };
    } else if (url.match(/^file:\/\//)) {
        return { url, type: LinkType.LocalFile };
    }

    return null;
}

/**
 * Content script entry point
 */
export default (context: ContentScriptContext) => {
    return {
        plugin: (codeMirrorWrapper: CodeMirrorWrapper) => {
            // Store link context for current cursor position
            let currentLinkContext: LinkContext | null = null;

            // Check CM6 availability
            if (!codeMirrorWrapper.cm6) {
                console.warn('[Context Utils] CodeMirror 6 not available');
                return;
            }

            const view: EditorView = codeMirrorWrapper.editor as EditorView;

            // Listen for cursor position changes
            // This is triggered when cursor moves or selection changes
            const updateListener = EditorView.updateListener.of((update) => {
                if (update.selectionSet) {
                    const pos = update.state.selection.main.head;
                    const newLinkContext = detectLinkAtPosition(view, pos);

                    // Only post message if link context changed
                    if (JSON.stringify(newLinkContext) !== JSON.stringify(currentLinkContext)) {
                        currentLinkContext = newLinkContext;
                        // Send update to main plugin
                        context.postMessage({
                            type: MESSAGE_TYPES.GET_LINK_CONTEXT,
                            data: currentLinkContext,
                        });
                    }
                }
            });

            codeMirrorWrapper.addExtension(updateListener);

            // Send initial state
            context.postMessage({
                type: MESSAGE_TYPES.GET_LINK_CONTEXT,
                data: currentLinkContext,
            });
        },
    };
};
