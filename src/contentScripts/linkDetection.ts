import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { SyntaxNode } from '@lezer/common';
import { LinkContext, CodeContext, EditorContext, LinkType, MESSAGE_TYPES } from '../types';
import type { ContentScriptContext, CodeMirrorWrapper } from '../types';
import { logger } from '../logger';

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
                const parsedCode = parseCodeBlock(node.node, view);

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
            // Check for markdown link syntax [text](url)
            else if (type.name === 'Link') {
                const url = extractUrl(node.node, view);
                const classified = url ? classifyUrl(url) : null;

                if (classified) {
                    context = {
                        contextType: 'link',
                        ...classified,
                        from,
                        to,
                    };
                    return false; // Stop iteration
                }
            }
            // Check for markdown image syntax ![alt](url)
            else if (type.name === 'Image') {
                const url = extractUrl(node.node, view);
                const classified = url ? classifyUrl(url) : null;

                if (classified) {
                    context = {
                        contextType: 'link',
                        ...classified,
                        from,
                        to,
                    };
                    return false; // Stop iteration
                }
            }
            // Check for bare URLs and autolinks
            else if (type.name === 'URL' || type.name === 'Autolink') {
                const urlText = view.state.doc.sliceString(from, to);
                // Remove angle brackets if present (<url>)
                const url = urlText.replace(/^<|>$/g, '');
                const classified = classifyUrl(url);

                if (classified) {
                    context = {
                        contextType: 'link',
                        ...classified,
                        from,
                        to,
                    };
                    return false; // Stop iteration
                }
            }
            // Check for HTML tags (img elements)
            else if (type.name === 'HTMLTag' || type.name === 'HTMLBlock') {
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
 * Extracts URL from a Link or Image node by traversing its children
 * Properly handles nested parentheses and special characters
 */
function extractUrl(node: SyntaxNode, view: EditorView): string | null {
    const cursor = node.cursor();

    // Enter the node
    if (!cursor.firstChild()) return null;

    // Traverse children to find the URL node
    do {
        if (cursor.name === 'URL') {
            return view.state.doc.sliceString(cursor.from, cursor.to);
        }
    } while (cursor.nextSibling());

    return null;
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
    if (url.match(/^:\/[a-f0-9]{32}(#[^\s]*)?$/i)) {
        return { url, type: LinkType.JoplinResource };
    } else if (url.match(/^mailto:/i)) {
        return { url, type: LinkType.Email };
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
 * Parses code block and extracts content using syntax tree traversal
 * Handles fenced code blocks with or without language specifier
 * Properly handles nested backticks by extracting only the CodeText node
 * Falls back to regex if no CodeText child is found
 */
function parseCodeBlock(node: SyntaxNode, view: EditorView): Omit<CodeContext, 'from' | 'to' | 'contextType'> | null {
    const cursor = node.cursor();

    // Try to find CodeText child node (syntax tree approach)
    if (cursor.firstChild()) {
        do {
            if (cursor.name === 'CodeText') {
                // Found CodeText child - extract it directly (excludes fence markers)
                const code = view.state.doc.sliceString(cursor.from, cursor.to);
                return { code };
            }
        } while (cursor.nextSibling());
    }

    // Fallback: If no CodeText child found, use regex to strip fence markers
    // This handles cases where FencedCode is a flat node
    const codeText = view.state.doc.sliceString(node.from, node.to);
    const match = codeText.match(/^```[^\n]*\n([\s\S]*?)```$/m) || codeText.match(/^~~~[^\n]*\n([\s\S]*?)~~~$/m);

    if (!match) {
        return null;
    }

    return { code: match[1] };
}

/**
 * Compares two EditorContext objects for equality
 * More efficient than JSON.stringify comparison, especially for frequent cursor movements
 */
function contextEquals(a: EditorContext | null, b: EditorContext | null): boolean {
    // Both null/undefined
    if (!a && !b) return true;

    // One null, one not
    if (!a || !b) return false;

    // Different types or positions
    if (a.contextType !== b.contextType || a.from !== b.from || a.to !== b.to) {
        return false;
    }

    // Type-specific comparison
    if (a.contextType === 'link' && b.contextType === 'link') {
        return a.url === b.url && a.type === b.type;
    } else if (a.contextType === 'code' && b.contextType === 'code') {
        return a.code === b.code;
    }

    return false;
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
                logger.warn('CodeMirror 6 not available');
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
                    if (!contextEquals(newContext, currentContext)) {
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
