import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import type { SyntaxNodeRef } from '@lezer/common';
import {
    LinkContext,
    CodeContext,
    TaskContext,
    TaskInfo,
    EditorContext,
    FootnoteContext,
    LinkSelectionContext,
    LinkInfo,
    HeadingContext,
    QuoteContext,
    LinkType,
} from '../types';
import { getHeadingAtPosition } from './headingExtraction';
import { getQuoteAtPosition } from './quoteExtraction';
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
 * Matches a task list checkbox at the start of a line.
 * Allows optional leading blockquote markers (e.g. `> - [ ] Task`, including
 * nested `> > `) and indentation before the list marker.
 * Group 1: the full prefix up to the checkbox. Group 2: the checkbox state char.
 */
const TASK_CHECKBOX_PATTERN = /^(\s*(?:>\s*)*[-*+]\s+)\[([x ])\]/;

/**
 * Detects context at cursor position using CodeMirror 6 syntax tree
 * Can detect links, images, inline code, code blocks, or tasks
 * Returns an array of contexts to support multiple contexts at the same position
 * (e.g., inline code within a task list item)
 *
 * @param view - CodeMirror 6 EditorView instance
 * @param pos - Cursor position to check
 * @returns Array of EditorContext (may be empty)
 */
export function detectContextAtPosition(view: EditorView, pos: number): EditorContext[] {
    const taskContext = detectTasksInSelectionRanges(view);

    // Check if any range is a real selection (not just a cursor). Covers multiple
    // selections, including when the main range is a bare cursor but others aren't.
    const hasNonEmptyRange = view.state.selection.ranges.some((range) => range.from !== range.to);
    if (hasNonEmptyRange) {
        const selectionContexts: EditorContext[] = [];

        if (taskContext) {
            selectionContexts.push(taskContext);
        }

        // Check for links across all selection ranges (for batch title fetching)
        const linkSelection = detectLinksInSelection(view);
        if (linkSelection) {
            selectionContexts.push(linkSelection);
        }

        // Return selection contexts if any found
        if (selectionContexts.length > 0) {
            return selectionContexts;
        }
        // If selection doesn't contain tasks or links, fall through to normal detection
    }

    const contexts: EditorContext[] = [];

    // First, detect primary context (code, links, images) via syntax tree
    const primaryContext = detectPrimaryContext(view, pos);
    if (primaryContext) {
        contexts.push(primaryContext);
    }

    // Then, always check if we're on a task line
    // This allows showing both task AND primary context menu items
    if (taskContext) {
        contexts.push(taskContext);
    }

    // Always check if we're on a heading (secondary context)
    // This allows showing heading link options alongside e.g. inline code in a heading
    const headingContext = detectHeadingContext(view, pos);
    if (headingContext) {
        contexts.push(headingContext);
    }

    // Always check if we're in a block quote (secondary context)
    // This allows showing quote actions alongside e.g. inline code or links in a quote
    const quoteContext = detectQuoteContext(view, pos);
    if (quoteContext) {
        contexts.push(quoteContext);
    }

    return contexts;
}

/**
 * Detects heading context at the cursor position.
 * Returns a HeadingContext with the heading text and unique anchor if the
 * cursor is on a heading, null otherwise.
 *
 * @param view - CodeMirror EditorView
 * @param pos - Cursor position
 */
function detectHeadingContext(view: EditorView, pos: number): HeadingContext | null {
    const heading = getHeadingAtPosition(view, pos);
    if (!heading) {
        return null;
    }

    const line = view.state.doc.lineAt(pos);
    return {
        contextType: 'heading',
        headingText: heading.text,
        headingAnchor: heading.anchor,
        from: line.from,
        to: line.to,
    };
}

/**
 * Detects block quote context at the cursor position.
 * Returns a QuoteContext with quote markers removed if the cursor is inside a
 * block quote, null otherwise.
 *
 * @param view - CodeMirror EditorView
 * @param pos - Cursor position
 */
function detectQuoteContext(view: EditorView, pos: number): QuoteContext | null {
    const quote = getQuoteAtPosition(view, pos);
    if (!quote) {
        return null;
    }

    return {
        contextType: 'quote',
        quoteText: quote.text,
        from: quote.from,
        to: quote.to,
    };
}

/**
 * Detects primary context (code, links, images) via syntax tree traversal
 * Does NOT include task detection (that's handled separately)
 *
 * @param view - CodeMirror 6 EditorView instance
 * @param pos - Cursor position to check
 * @returns Primary context if found, null otherwise
 */
function detectPrimaryContext(view: EditorView, pos: number): LinkContext | CodeContext | FootnoteContext | null {
    const tree = syntaxTree(view.state);
    let context: LinkContext | CodeContext | null = null;

    // Traverse syntax tree to find nodes at position
    tree.iterate({
        from: pos,
        to: pos,
        enter: (node) => {
            const detectedContext = detectContextForNode(view, node);
            if (detectedContext) {
                context = detectedContext;
                return false;
            }
        },
    });

    return context ?? detectFootnoteContext(view, pos);
}

/**
 * Maps supported syntax node types to their specialized context detectors.
 *
 * @param view - CodeMirror EditorView
 * @param node - Syntax node at the cursor position
 * @returns Detected link or code context, null for unsupported nodes
 */
function detectContextForNode(view: EditorView, node: SyntaxNodeRef): LinkContext | CodeContext | null {
    switch (node.type.name) {
        case 'InlineCode':
        case 'CodeText':
            return detectInlineCodeContext(view, node);
        case 'FencedCode':
        case 'CodeBlock':
            return detectCodeBlockContext(view, node);
        case 'Link':
            return detectLinkContext(view, node);
        case 'Image':
            return detectMarkdownImageContext(view, node);
        case 'URL':
        case 'Autolink':
            return detectUrlContext(view, node);
        case 'HTMLTag':
        case 'HTMLBlock':
            return detectHtmlImageContext(view, node);
        default:
            return null;
    }
}

function detectInlineCodeContext(view: EditorView, node: SyntaxNodeRef): CodeContext | null {
    const codeText = view.state.doc.sliceString(node.from, node.to);
    const parsedCode = parseInlineCode(codeText);
    if (!parsedCode) {
        return null;
    }

    return {
        contextType: 'code',
        ...parsedCode,
        from: node.from,
        to: node.to,
    };
}

function detectCodeBlockContext(view: EditorView, node: SyntaxNodeRef): CodeContext | null {
    const parsedCode = parseCodeBlock(node.node, view);
    if (!parsedCode) {
        return null;
    }

    return {
        contextType: 'code',
        ...parsedCode,
        from: node.from,
        to: node.to,
    };
}

/**
 * Detects a direct or reference-style Markdown link from a Link syntax node.
 * Direct links retain both the URL range and full Markdown range so callers can
 * replace the complete link while preserving its optional title attribute.
 *
 * @param view - CodeMirror EditorView
 * @param node - Link syntax node to inspect
 * @returns Link context if the URL can be classified, null otherwise
 */
function detectLinkContext(view: EditorView, node: SyntaxNodeRef): LinkContext | null {
    const extracted = extractUrl(node.node, view);
    if (extracted) {
        const classified = classifyUrl(extracted.url);
        if (classified) {
            const fullLinkText = view.state.doc.sliceString(node.from, node.to);
            return {
                contextType: 'link',
                ...classified,
                from: extracted.from,
                to: extracted.to,
                // Track full Markdown link range for replacement.
                markdownLinkFrom: node.from,
                markdownLinkTo: node.to,
                // Preserve optional title attribute.
                linkTitleToken: extracted.linkTitleToken,
                expectedText: fullLinkText,
            };
        }
    }

    let label = extractReferenceLabel(node.node, view);
    // Shortcut links have no LinkLabel child; collapsed links have a LinkLabel
    // whose literal value is "[]", so both forms fall back to the full node text.
    if (!label || label === '[]') {
        label = view.state.doc.sliceString(node.from, node.to).replace(/\[\]$/, '');
    }

    const refUrl = label ? findReferenceDefinition(view, label) : null;
    const classified = refUrl ? classifyUrl(refUrl) : null;
    if (!classified) {
        return null;
    }

    return {
        contextType: 'link',
        ...classified,
        from: node.from,
        to: node.to,
        isReferenceLink: true,
    };
}

function detectMarkdownImageContext(view: EditorView, node: SyntaxNodeRef): LinkContext | null {
    const extracted = extractUrl(node.node, view);
    const classified = extracted ? classifyUrl(extracted.url) : null;
    if (!classified) {
        return null;
    }

    return {
        contextType: 'link',
        ...classified,
        from: node.from,
        to: node.to,
        isImage: true,
    };
}

function detectUrlContext(view: EditorView, node: SyntaxNodeRef): LinkContext | null {
    const urlText = view.state.doc.sliceString(node.from, node.to);
    const url = urlText.replace(/^<|>$/g, '');
    const classified = classifyUrl(url);
    if (!classified) {
        return null;
    }

    return {
        contextType: 'link',
        ...classified,
        from: node.from,
        to: node.to,
        expectedText: urlText,
    };
}

function detectHtmlImageContext(view: EditorView, node: SyntaxNodeRef): LinkContext | null {
    const htmlText = view.state.doc.sliceString(node.from, node.to);
    const parsedImage = parseImageTag(htmlText);
    if (!parsedImage) {
        return null;
    }

    return {
        contextType: 'link',
        ...parsedImage,
        from: node.from,
        to: node.to,
        isImage: true,
    };
}

/**
 * Detects a footnote reference at the cursor using a current-line text scan.
 * CodeMirror's Markdown parser does not recognize footnote syntax, so this runs
 * only after syntax-tree detection and returns a context only for a defined label.
 *
 * @param view - CodeMirror EditorView
 * @param pos - Cursor position to inspect
 * @returns Footnote context if a matching definition exists, null otherwise
 */
function detectFootnoteContext(view: EditorView, pos: number): FootnoteContext | null {
    const line = view.state.doc.lineAt(pos);
    const relativePos = pos - line.from;
    const footnoteRegex = /\[\^([^\]]+)\]/g;
    let match;

    while ((match = footnoteRegex.exec(line.text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (relativePos < start || relativePos > end) {
            continue;
        }

        const label = match[1];
        const targetPos = findFootnoteDefinition(view, label);
        if (targetPos === null) {
            continue;
        }

        return {
            contextType: 'footnote',
            label,
            targetPos,
            from: line.from + start,
            to: line.from + end,
        };
    }

    return null;
}

/**
 * Detects task context at the current line
 * This is separate from primary context detection to allow showing both
 * Uses syntax tree to verify we're in a Task node
 *
 * @param view - CodeMirror EditorView
 * @param pos - Cursor position
 * @returns TaskInfo if on a task list line, null otherwise
 */
function detectTaskAtPosition(view: EditorView, pos: number): TaskInfo | null {
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
    // (also matches checkboxes inside block quotes, e.g. "> - [ ] Task")
    const checkboxMatch = lineText.match(TASK_CHECKBOX_PATTERN);
    if (!checkboxMatch) {
        return null;
    }

    const checked = checkboxMatch[2] === 'x';
    return {
        lineText,
        checked,
        from: line.from,
        to: line.to,
    };
}

/**
 * Detects task list checkboxes across all CodeMirror selection ranges.
 * Cursor ranges detect their current task line; non-empty ranges scan selected task lines.
 * Uses syntax tree to verify each line is in a Task node
 *
 * @param view - CodeMirror EditorView
 * @returns TaskContext if tasks found, null otherwise
 */
function detectTasksInSelectionRanges(view: EditorView): TaskContext | null {
    const tasks = new Map<number, TaskInfo>();

    for (const range of view.state.selection.ranges) {
        const rangeTasks =
            range.from === range.to
                ? [detectTaskAtPosition(view, range.head)].filter((task): task is TaskInfo => task !== null)
                : collectTasksInRange(view, range.from, range.to);

        for (const task of rangeTasks) {
            tasks.set(task.from, task);
        }
    }

    const sortedTasks = [...tasks.values()].sort((a, b) => a.from - b.from);
    if (sortedTasks.length === 0) return null;

    return buildTaskContext(sortedTasks);
}

function collectTasksInRange(view: EditorView, from: number, to: number): TaskInfo[] {
    const tasks: TaskInfo[] = [];
    const doc = view.state.doc;
    const tree = syntaxTree(view.state);

    // OPTIMIZATION: Iterate the tree ONCE for this selected range
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
                // Strict Regex: Matches "- [ ] " or "* [x] " (incl. inside block quotes)
                const checkboxMatch = lineText.match(TASK_CHECKBOX_PATTERN);

                if (checkboxMatch) {
                    const checked = checkboxMatch[2] === 'x';
                    tasks.push({
                        lineText,
                        checked,
                        from: line.from,
                        to: line.to,
                    });
                }
                // Do NOT return false here, so we continue to traverse children (nested lists)
            }
        },
    });

    return tasks;
}

function buildTaskContext(tasks: TaskInfo[]): TaskContext {
    const checkedCount = tasks.filter((task) => task.checked).length;
    const uncheckedCount = tasks.length - checkedCount;

    return {
        contextType: 'task',
        tasks,
        checkedCount,
        uncheckedCount,
    };
}

/**
 * Detects external HTTP(S) links across all non-empty CodeMirror selection ranges.
 * Only includes external URLs (not Joplin resources, emails, or anchors).
 * Excludes reference-style links since they can't be updated in place.
 *
 * @param view - CodeMirror EditorView
 * @returns LinkSelectionContext if external links found, null otherwise
 */
function detectLinksInSelection(view: EditorView): LinkSelectionContext | null {
    const links: LinkInfo[] = [];
    const seenRanges = new Set<string>(); // Deduplicate by position across ranges

    for (const range of view.state.selection.ranges) {
        // Cursor ranges are handled by the single-link primary-context path
        if (range.from === range.to) continue;
        collectLinksInRange(view, range.from, range.to, links, seenRanges);
    }

    if (links.length === 0) return null;

    // Order links by document position (selection ranges may be out of order)
    links.sort((a, b) => a.from - b.from);

    return {
        contextType: 'linkSelection',
        links,
        from: links[0].from,
        to: Math.max(...links.map((link) => link.to)),
    };
}

/**
 * Scans a single range for external link/URL/autolink nodes, appending any
 * matches to the shared `links` array. `seenRanges` deduplicates by absolute
 * position when multiple ranges touch the same link node.
 */
function collectLinksInRange(
    view: EditorView,
    from: number,
    to: number,
    links: LinkInfo[],
    seenRanges: Set<string>
): void {
    const tree = syntaxTree(view.state);

    tree.iterate({
        from: from,
        to: to,
        enter: (node) => {
            switch (node.type.name) {
                case 'Link': {
                    const link = buildMarkdownLink(view, node);
                    if (link) {
                        appendUniqueLink(link, links, seenRanges);
                    }
                    // Skip child URL nodes and reference-link labels.
                    return false;
                }
                case 'URL':
                case 'Autolink': {
                    const link = buildBareUrlLink(view, node);
                    if (link) {
                        appendUniqueLink(link, links, seenRanges);
                    }
                    // Continue traversal; nested autolink URL nodes are filtered by buildBareUrlLink.
                    return;
                }
            }
        },
    });
}

function buildMarkdownLink(view: EditorView, node: SyntaxNodeRef): LinkInfo | null {
    const extracted = extractUrl(node.node, view);
    if (!extracted) {
        return null;
    }

    const classified = classifyUrl(extracted.url);
    if (!classified || classified.type !== LinkType.ExternalUrl) {
        return null;
    }

    const fullLinkText = view.state.doc.sliceString(node.from, node.to);
    return {
        url: classified.url,
        type: classified.type,
        from: extracted.from,
        to: extracted.to,
        markdownLinkFrom: node.from,
        markdownLinkTo: node.to,
        linkTitleToken: extracted.linkTitleToken,
        expectedText: fullLinkText,
    };
}

function buildBareUrlLink(view: EditorView, node: SyntaxNodeRef): LinkInfo | null {
    const parentType = node.node.parent?.type.name;
    const isEmbedded = parentType === 'Image' || parentType === 'HTMLTag' || parentType === 'HTMLBlock';
    const isNestedAutolinkUrl = node.type.name === 'URL' && parentType === 'Autolink';
    if (isEmbedded || isNestedAutolinkUrl) {
        return null;
    }

    const urlText = view.state.doc.sliceString(node.from, node.to);
    const url = urlText.replace(/^<|>$/g, '');
    const classified = classifyUrl(url);
    if (!classified || classified.type !== LinkType.ExternalUrl) {
        return null;
    }

    return {
        url: classified.url,
        type: classified.type,
        from: node.from,
        to: node.to,
        expectedText: urlText,
    };
}

function appendUniqueLink(link: LinkInfo, links: LinkInfo[], seenRanges: Set<string>): void {
    const key = `${link.from}-${link.to}`;
    if (seenRanges.has(key)) {
        return;
    }

    seenRanges.add(key);
    links.push(link);
}
