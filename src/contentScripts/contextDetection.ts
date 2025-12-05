import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import {
    LinkContext,
    CodeContext,
    CheckboxContext,
    TaskSelectionContext,
    TaskInfo,
    EditorContext,
    FootnoteContext,
} from '../types';
import {
    parseInlineCode,
    parseCodeBlock,
    extractUrl,
    classifyUrl,
    parseImageTag,
    extractReferenceLabel,
    findReferenceDefinition,
    findFootnoteDefinition,
} from './parsingUtils';

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
export function detectContextAtPosition(view: EditorView, pos: number): EditorContext[] {
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
function detectPrimaryContext(view: EditorView, pos: number): LinkContext | CodeContext | FootnoteContext | null {
    const tree = syntaxTree(view.state);
    let context: LinkContext | CodeContext | FootnoteContext | null = null;

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
                let url = extractUrl(node.node, view);

                // If no URL found, check if it's a reference link
                if (!url) {
                    let label = extractReferenceLabel(node.node, view);

                    // Handle shortcut [foo] and collapsed [foo][] reference links
                    // - Shortcut: [foo] has no LinkLabel child, extractReferenceLabel returns null
                    // - Collapsed: [foo][] has LinkLabel child with value "[]"
                    if (!label || label === '[]') {
                        label = view.state.doc.sliceString(from, to);
                        // Strip trailing [] for collapsed reference links
                        label = label.replace(/\[\]$/, '');
                    }

                    if (label) {
                        url = findReferenceDefinition(view, label);
                    }
                }

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

    // If no context found yet, check for footnotes
    // Footnotes might not be parsed as specific nodes, so we check the text
    if (!context) {
        const line = view.state.doc.lineAt(pos);
        const lineText = line.text;
        const relativePos = pos - line.from;

        // Regex to find all footnotes in the line: [^label]
        const footnoteRegex = /\[\^([^\]]+)\]/g;
        let match;
        while ((match = footnoteRegex.exec(lineText)) !== null) {
            const start = match.index;
            const end = start + match[0].length;

            // Check if cursor is within this footnote reference
            if (relativePos >= start && relativePos <= end) {
                const label = match[1];
                const targetPos = findFootnoteDefinition(view, label);

                if (targetPos !== null) {
                    context = {
                        contextType: 'footnote',
                        label,
                        targetPos,
                        from: line.from + start,
                        to: line.from + end,
                    };
                    break;
                }
            }
        }
    }

    return context;
}

/**
 * Detects checkbox context at the current line
 * This is separate from primary context detection to allow showing both
 * Uses syntax tree to verify we're in a Task node
 *
 * @param view - CodeMirror EditorView
 * @param pos - Cursor position
 * @returns CheckboxContext if on a task list line, null otherwise
 */
function detectCheckboxContext(view: EditorView, pos: number): CheckboxContext | null {
    const tree = syntaxTree(view.state);
    let isInTaskList = false;

    // Check if cursor is within a Task node (GFM task list item)
    // This prevents false positives inside code blocks
    tree.iterate({
        from: pos,
        to: pos,
        enter: (node) => {
            if (node.name === 'Task') {
                isInTaskList = true;
                return false; // Stop iteration
            }
        },
    });

    // Only check for checkbox pattern if we're in a task list item
    if (!isInTaskList) {
        return null;
    }

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
 * Detects task list checkboxes within a text selection
 * Scans all lines in the selection range for task list items
 * Uses syntax tree to verify each line is in a Task node
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
    const doc = view.state.doc;
    const tree = syntaxTree(view.state);

    // OPTIMIZATION: Iterate the tree ONCE for the entire selection range
    tree.iterate({
        from: from,
        to: to,
        enter: (node) => {
            // Check for Task nodes (GFM task list items)
            if (node.name === 'Task') {
                const line = doc.lineAt(node.from);

                // Deduplicate: If multiple Task nodes appear on the same line, skip subsequent ones
                const lastTask = tasks[tasks.length - 1];
                if (lastTask && doc.lineAt(lastTask.from).number === line.number) return;

                const lineText = line.text;
                // Strict Regex: Matches "- [ ] " or "* [x] "
                const checkboxMatch = lineText.match(/^(\s*[-*+]\s+)\[([x ])\]/);

                if (checkboxMatch) {
                    const checked = checkboxMatch[2] === 'x';
                    tasks.push({
                        lineText,
                        checked,
                        from: line.from,
                        to: line.to,
                    });

                    if (checked) checkedCount++;
                    else uncheckedCount++;
                }
                // Do NOT return false here, so we continue to traverse children (nested lists)
            }
        },
    });

    if (tasks.length === 0) return null;

    return {
        contextType: 'taskSelection',
        tasks,
        checkedCount,
        uncheckedCount,
        from,
        to,
    };
}
