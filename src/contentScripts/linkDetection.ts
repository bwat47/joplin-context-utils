import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { SyntaxNode } from '@lezer/common';
import {
    LinkContext,
    CodeContext,
    CheckboxContext,
    TaskSelectionContext,
    TaskInfo,
    EditorContext,
    LinkType,
} from '../types';
import type { ContentScriptContext, CodeMirrorWrapper } from '../types';
import { logger } from '../logger';

/**
 * Command name for getting context at cursor
 */
export const GET_CONTEXT_AT_CURSOR_COMMAND = 'contextUtils-getContextAtCursor';

/**
 * Command name for replacing a range of text in the editor
 */
export const REPLACE_RANGE_COMMAND = 'contextUtils-replaceRange';

/**
 * Detects context at cursor position using CodeMirror 6 syntax tree
 * Can detect links, images, inline code, code blocks, or task selections
 * Returns an array of contexts to support multiple contexts at the same position
 * (e.g., inline code within a task list item)
 *
 * @param view - CodeMirror 6 EditorView instance
 * @param pos - Cursor position to check
 * @returns Array of EditorContext (may be empty)
 */
function detectContextAtPosition(view: EditorView, pos: number): EditorContext[] {
    const selection = view.state.selection.main;

    // Check if there's a selection (not just cursor)
    if (selection.from !== selection.to) {
        // Check for tasks in selection
        const taskSelection = detectTasksInSelection(view, selection.from, selection.to);
        if (taskSelection) {
            return [taskSelection];
        }
        // If selection doesn't contain tasks, fall through to normal detection
    }

    const contexts: EditorContext[] = [];

    // First, detect primary context (code, links, images) via syntax tree
    const primaryContext = detectPrimaryContext(view, pos);
    if (primaryContext) {
        contexts.push(primaryContext);
    }

    // Then, always check if we're on a checkbox line
    // This allows showing both checkbox AND primary context menu items
    const checkboxContext = detectCheckboxContext(view, pos);
    if (checkboxContext) {
        contexts.push(checkboxContext);
    }

    return contexts;
}

/**
 * Detects primary context (code, links, images) via syntax tree traversal
 * Does NOT include checkbox detection (that's handled separately)
 *
 * @param view - CodeMirror 6 EditorView instance
 * @param pos - Cursor position to check
 * @returns Primary context if found, null otherwise
 */
function detectPrimaryContext(view: EditorView, pos: number): LinkContext | CodeContext | null {
    const tree = syntaxTree(view.state);
    let context: LinkContext | CodeContext | null = null;

    // Traverse syntax tree to find nodes at position
    tree.iterate({
        from: pos,
        to: pos,
        enter: (node) => {
            const { type, from, to } = node;

            // Check for code blocks and inline code (highest priority)
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
 * Detects checkbox context at the current line
 * This is separate from primary context detection to allow showing both
 *
 * @param view - CodeMirror EditorView
 * @param pos - Cursor position
 * @returns CheckboxContext if on a task list line, null otherwise
 */
function detectCheckboxContext(view: EditorView, pos: number): CheckboxContext | null {
    const line = view.state.doc.lineAt(pos);
    const lineText = line.text;

    // Match task list checkbox: "  - [ ] Task" or "    * [x] Done"
    const checkboxMatch = lineText.match(/^(\s*[-*+]\s+)\[([x ])\]/);
    if (!checkboxMatch) {
        return null;
    }

    const checked = checkboxMatch[2] === 'x';
    return {
        contextType: 'checkbox',
        checked,
        lineText,
        from: line.from,
        to: line.to,
    };
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
 * Detects task list checkboxes within a text selection
 * Scans all lines in the selection range for task list items
 *
 * @param view - CodeMirror EditorView
 * @param from - Start of selection
 * @param to - End of selection
 * @returns TaskSelectionContext if tasks found, null otherwise
 */
function detectTasksInSelection(view: EditorView, from: number, to: number): TaskSelectionContext | null {
    const tasks: TaskInfo[] = [];
    let checkedCount = 0;
    let uncheckedCount = 0;

    // Get the starting and ending lines
    const startLine = view.state.doc.lineAt(from);
    const endLine = view.state.doc.lineAt(to);

    // Iterate through all lines in the selection
    for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
        const line = view.state.doc.line(lineNum);
        const lineText = line.text;

        // Check if this line contains a task list checkbox
        const checkboxMatch = lineText.match(/^(\s*[-*+]\s+)\[([x ])\]/);

        if (checkboxMatch) {
            const checked = checkboxMatch[2] === 'x';

            tasks.push({
                lineText,
                checked,
                from: line.from,
                to: line.to,
            });

            if (checked) {
                checkedCount++;
            } else {
                uncheckedCount++;
            }
        }
    }

    // Only return context if we found at least one task
    if (tasks.length === 0) {
        return null;
    }

    return {
        contextType: 'taskSelection',
        tasks,
        checkedCount,
        uncheckedCount,
        from,
        to,
    };
}

/**
 * Content script entry point
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default (_context: ContentScriptContext) => {
    return {
        plugin: (codeMirrorWrapper: CodeMirrorWrapper) => {
            // Check CM6 availability
            if (!codeMirrorWrapper.cm6) {
                logger.warn('CodeMirror 6 not available');
                return;
            }

            const view: EditorView = codeMirrorWrapper.editor as EditorView;

            // Register command to get context at cursor (pull architecture)
            // This is called on-demand when the context menu opens
            codeMirrorWrapper.registerCommand(GET_CONTEXT_AT_CURSOR_COMMAND, () => {
                const pos = view.state.selection.main.head;
                const context = detectContextAtPosition(view, pos);
                logger.debug('Context detected at cursor:', context);
                return context;
            });

            // Register command to replace a range of text in the editor
            // Used for checkbox toggling and other text replacement operations
            codeMirrorWrapper.registerCommand(REPLACE_RANGE_COMMAND, (newText: string, from: number, to: number) => {
                // Validate inputs
                if (typeof newText !== 'string') {
                    logger.error('replaceRange: newText must be a string');
                    return false;
                }

                if (
                    typeof from !== 'number' ||
                    typeof to !== 'number' ||
                    !Number.isFinite(from) ||
                    !Number.isFinite(to)
                ) {
                    logger.error('replaceRange: from and to must be finite numbers');
                    return false;
                }

                if (from > to) {
                    logger.error('replaceRange: from must be <= to');
                    return false;
                }

                try {
                    // Perform the text replacement
                    view.dispatch({
                        changes: { from, to, insert: newText },
                    });
                    logger.debug(`Replaced text from ${from} to ${to} with:`, newText);
                    return true;
                } catch (error) {
                    logger.error('replaceRange: failed to replace text:', error);
                    return false;
                }
            });
        },
    };
};
