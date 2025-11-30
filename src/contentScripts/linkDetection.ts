import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { LinkContext, CodeContext, EditorContext, LinkType, MESSAGE_TYPES } from '../types';
import type { ContentScriptContext, CodeMirrorWrapper } from '../types';

/**
 * Detects context at cursor position using CodeMirror 6 syntax tree
 * Can detect links, images, inline code, or code blocks
 *
 * @param view - CodeMirror 6 EditorView instance
 * @param pos - Cursor position to check
 * @returns EditorContext (LinkContext or CodeContext) if found, null otherwise
 */
function detectContextAtPosition(view: EditorView, pos: number): EditorContext | null {
    const tree = syntaxTree(view.state);
    let context: EditorContext | null = null;

    // Traverse syntax tree to find nodes at position
    tree.iterate({
        from: pos,
        to: pos,
        enter: (node) => {
            const { type, from, to } = node;

            // Check for code blocks and inline code (higher priority)
            if (type.name === 'InlineCode' || type.name === 'CodeText') {
                const codeText = view.state.doc.sliceString(from, to);
                const parsedCode = parseInlineCode(codeText);

                if (parsedCode) {
                    context = {
                        contextType: 'code',
                        ...parsedCode,
                        from,
                        to,
                    };
                    return false; // Stop iteration
                }
            } else if (type.name === 'FencedCode' || type.name === 'CodeBlock') {
                const codeText = view.state.doc.sliceString(from, to);
                const parsedCode = parseCodeBlock(codeText);

                if (parsedCode) {
                    context = {
                        contextType: 'code',
                        ...parsedCode,
                        from,
                        to,
                    };
                    return false; // Stop iteration
                }
            }
            // Check for different link node types from @lezer/markdown
            else if (type.name === 'Link' || type.name === 'URL' || type.name === 'Autolink') {
                const linkText = view.state.doc.sliceString(from, to);
                const parsedLink = parseLink(linkText, type.name);

                if (parsedLink) {
                    context = {
                        contextType: 'link',
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
                    context = {
                        contextType: 'link',
                        ...parsedImage,
                        from,
                        to,
                    };
                    return false; // Stop iteration
                }
            }
        },
    });

    return context;
}

/**
 * Parses link text and determines link type
 * Handles both markdown syntax [text](url) and bare URLs
 */
function parseLink(linkText: string, nodeType: string): Omit<LinkContext, 'from' | 'to' | 'contextType'> | null {
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
function parseImageTag(htmlText: string): Omit<LinkContext, 'from' | 'to' | 'contextType'> | null {
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
function classifyUrl(url: string): Omit<LinkContext, 'from' | 'to' | 'contextType'> | null {
    // Determine link type
    if (url.match(/^:\/[a-f0-9]{32}$/i)) {
        return { url, type: LinkType.JoplinResource };
    } else if (url.match(/^https?:\/\//)) {
        return { url, type: LinkType.ExternalUrl };
    }

    return null;
}

/**
 * Parses inline code and extracts content
 * Handles backtick-wrapped inline code
 */
function parseInlineCode(codeText: string): Omit<CodeContext, 'from' | 'to' | 'contextType'> | null {
    // Remove backticks from inline code
    const match = codeText.match(/^`(.+)`$/s);
    if (!match) {
        return null;
    }

    return { code: match[1] };
}

/**
 * Parses code block and extracts content
 * Handles fenced code blocks with or without language specifier
 */
function parseCodeBlock(codeText: string): Omit<CodeContext, 'from' | 'to' | 'contextType'> | null {
    // Remove fence markers and language from code block
    // Match ``` or ~~~ with optional language, then code, then closing fence
    const match = codeText.match(/^```[^\n]*\n([\s\S]*?)```$/m) || codeText.match(/^~~~[^\n]*\n([\s\S]*?)~~~$/m);

    if (!match) {
        return null;
    }

    return { code: match[1] };
}

/**
 * Content script entry point
 */
export default (context: ContentScriptContext) => {
    return {
        plugin: (codeMirrorWrapper: CodeMirrorWrapper) => {
            // Store current context (link, code, etc.) for current cursor position
            let currentContext: EditorContext | null = null;

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
                    const newContext = detectContextAtPosition(view, pos);

                    // Only post message if context changed
                    if (JSON.stringify(newContext) !== JSON.stringify(currentContext)) {
                        currentContext = newContext;
                        // Send update to main plugin
                        context.postMessage({
                            type: MESSAGE_TYPES.GET_CONTEXT,
                            data: currentContext,
                        });
                    }
                }
            });

            codeMirrorWrapper.addExtension(updateListener);

            // Send initial state
            context.postMessage({
                type: MESSAGE_TYPES.GET_CONTEXT,
                data: currentContext,
            });
        },
    };
};
