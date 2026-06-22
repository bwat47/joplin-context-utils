import joplin from 'api';
import {
    COMMAND_IDS,
    LinkContext,
    CodeContext,
    TaskContext,
    LinkType,
    FootnoteContext,
    LinkSelectionContext,
    HeadingContext,
    QuoteContext,
} from './types';
import { showToast, ToastType } from './utils/toastUtils';
import { logger } from './logger';
import { extractJoplinResourceId } from './utils/urlUtils';
import {
    REPLACE_RANGE_COMMAND,
    BATCH_REPLACE_COMMAND,
    SCROLL_TO_POSITION_COMMAND,
} from './contentScripts/contentScript';
import { toggleCheckboxInLine } from './utils/checkboxUtils';
import { getTaskTogglePlan } from './utils/taskToggleUtils';
import { fetchLinkTitle, buildTitleAttributeToken, escapeMarkdownLinkText } from './utils/linkTitleUtils';
import { formatInternalHeadingLink, formatExternalHeadingLink } from './utils/headingLinkFormatting';
import { settingsCache } from './settings';

/**
 * Registers all context menu commands
 */
export async function registerCommands(): Promise<void> {
    await joplin.commands.register({
        name: COMMAND_IDS.OPEN_LINK,
        label: 'Open Link',
        execute: async (linkContext: LinkContext) => {
            try {
                await handleOpenLink(linkContext);
            } catch (error) {
                logger.error('Failed to open link:', error);
                await showToast('Failed to open link', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.ADD_EXTERNAL_LINK,
        label: 'Add External Link',
        execute: async () => {
            try {
                await handleAddExternalLink();
            } catch (error) {
                logger.error('Failed to add external link:', error);
                await showToast('Failed to add external link', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.ADD_LINK_TO_NOTE,
        label: 'Add Link to Note',
        execute: async () => {
            try {
                await handleAddLinkToNote();
            } catch (error) {
                logger.error('Failed to add link to note:', error);
                await showToast('Failed to add link to note', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.COPY_PATH,
        label: 'Copy URL/Email',
        execute: async (linkContext: LinkContext) => {
            try {
                await handleCopyPath(linkContext);
            } catch (error) {
                logger.error('Failed to copy path:', error);
                await showToast('Failed to copy path', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.COPY_CODE,
        label: 'Copy Code',
        execute: async (codeContext: CodeContext) => {
            try {
                await handleCopyCode(codeContext);
            } catch (error) {
                logger.error('Failed to copy code:', error);
                await showToast('Failed to copy code', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.TOGGLE_CHECKBOX,
        label: 'Toggle Tasks',
        execute: async (taskContext: TaskContext) => {
            try {
                await handleToggleTasks(taskContext);
            } catch (error) {
                logger.error('Failed to toggle tasks:', error);
                await showToast('Failed to toggle tasks', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.GO_TO_FOOTNOTE,
        label: 'Go to Footnote',
        execute: async (footnoteContext: FootnoteContext) => {
            try {
                await handleGoToFootnote(footnoteContext);
            } catch (error) {
                logger.error('Failed to go to footnote:', error);
                await showToast('Failed to go to footnote', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.GO_TO_HEADING,
        label: 'Go to Heading',
        execute: async (linkContext: LinkContext) => {
            try {
                await handleGoToHeading(linkContext);
            } catch (error) {
                logger.error('Failed to go to heading:', error);
                await showToast('Failed to go to heading', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.PIN_TO_TABS,
        label: 'Open Note as Pinned Tab',
        execute: async (linkContext: LinkContext) => {
            try {
                await handlePinToTabs(linkContext);
            } catch (error) {
                logger.error('Failed to open note as pinned tab:', error);
                await showToast('Failed to open note as pinned tab (is Note Tabs installed?)', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.FETCH_LINK_TITLE,
        label: 'Fetch Link Title',
        execute: async (linkContext: LinkContext) => {
            try {
                await handleFetchLinkTitle(linkContext);
            } catch (error) {
                logger.error('Failed to fetch link title:', error);
                await showToast('Failed to fetch link title', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.FETCH_ALL_LINK_TITLES,
        label: 'Fetch All Link Titles',
        execute: async (linkSelectionContext: LinkSelectionContext) => {
            try {
                await handleBatchFetchLinkTitles(linkSelectionContext);
            } catch (error) {
                logger.error('Failed to fetch link titles:', error);
                await showToast('Failed to fetch link titles', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.COPY_HEADING_LINK_INTERNAL,
        label: 'Copy Heading Link (internal)',
        execute: async (headingContext: HeadingContext) => {
            try {
                await handleCopyHeadingLinkInternal(headingContext);
            } catch (error) {
                logger.error('Failed to copy heading link:', error);
                await showToast('Failed to copy heading link', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.COPY_HEADING_LINK_EXTERNAL,
        label: 'Copy Heading Link (external)',
        execute: async (headingContext: HeadingContext) => {
            try {
                await handleCopyHeadingLinkExternal(headingContext);
            } catch (error) {
                logger.error('Failed to copy heading link:', error);
                await showToast('Failed to copy heading link', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.COPY_QUOTE,
        label: 'Copy Quote',
        execute: async (quoteContext: QuoteContext) => {
            try {
                await handleCopyQuote(quoteContext);
            } catch (error) {
                logger.error('Failed to copy quote:', error);
                await showToast('Failed to copy quote', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.OPEN_ALL_LINKS_IN_SELECTION,
        label: 'Open All Links',
        execute: async (linkSelectionContext: LinkSelectionContext) => {
            try {
                await handleOpenAllLinksInSelection(linkSelectionContext);
            } catch (error) {
                logger.error('Failed to open links in selection:', error);
                await showToast('Failed to open links', ToastType.Error);
            }
        },
    });
}

/**
 * Unified "Open Link" handler
 * - External URLs: Open in browser
 * - Email links: Open in default mail client
 */
async function handleOpenLink(linkContext: LinkContext): Promise<void> {
    if (linkContext.type === LinkType.ExternalUrl || linkContext.type === LinkType.Email) {
        // Use Joplin's built-in command to open external URL
        await joplin.commands.execute('openItem', linkContext.url);
        logger.debug('Opened external URL:', linkContext.url);
    } else {
        throw new Error(`Unsupported link type: ${linkContext.type}`);
    }
}

/**
 * Unified "Copy URL/Email" handler
 * - External URLs: Copy URL to clipboard
 * - Email links: Copy email address to clipboard
 */
async function handleCopyPath(linkContext: LinkContext): Promise<void> {
    let textToCopy: string;

    if (linkContext.type === LinkType.ExternalUrl) {
        textToCopy = linkContext.url;
        logger.debug('Copying URL to clipboard:', textToCopy);
    } else if (linkContext.type === LinkType.Email) {
        textToCopy = linkContext.url.replace(/^mailto:/i, '');
        logger.debug('Copying email to clipboard:', textToCopy);
    } else {
        throw new Error(`Unsupported link type: ${linkContext.type}`);
    }

    await joplin.clipboard.writeText(textToCopy);
    await showToast('Copied to clipboard', ToastType.Success);
}

/**
 * "Copy Code" handler
 * Copies code content to clipboard
 */
async function handleCopyCode(codeContext: CodeContext): Promise<void> {
    await joplin.clipboard.writeText(codeContext.code);
    await showToast('Code copied to clipboard', ToastType.Success);
    logger.debug('Copied code to clipboard');
}

/**
 * "Copy Heading Link (internal)" handler
 * Copies a markdown link to the heading's in-note anchor: [Heading](#anchor)
 */
async function handleCopyHeadingLinkInternal(headingContext: HeadingContext): Promise<void> {
    const link = formatInternalHeadingLink(headingContext.headingText, headingContext.headingAnchor);
    await joplin.clipboard.writeText(link);
    await showToast('Heading link copied to clipboard', ToastType.Success);
    logger.debug('Copied internal heading link:', link);
}

/**
 * "Copy Heading Link (external)" handler
 * Copies a markdown link to the heading in the current note: [Heading @ Note](:/noteId#anchor)
 */
async function handleCopyHeadingLinkExternal(headingContext: HeadingContext): Promise<void> {
    const note = await joplin.workspace.selectedNote();
    if (!note) {
        throw new Error('No note is currently selected');
    }

    const link = formatExternalHeadingLink(
        headingContext.headingText,
        note.title,
        note.id,
        headingContext.headingAnchor
    );
    await joplin.clipboard.writeText(link);
    await showToast('Heading link copied to clipboard', ToastType.Success);
    logger.debug('Copied external heading link:', link);
}

/**
 * "Copy Quote" handler
 * Copies block quote content without leading quote markers.
 */
async function handleCopyQuote(quoteContext: QuoteContext): Promise<void> {
    await joplin.clipboard.writeText(quoteContext.quoteText);
    await showToast('Quote copied to clipboard', ToastType.Success);
    logger.debug('Copied quote to clipboard');
}

/**
 * "Toggle Tasks" handler
 * Checks unchecked tasks, or unchecks checked tasks when all affected tasks are checked.
 */
async function handleToggleTasks(taskContext: TaskContext): Promise<void> {
    const { targetChecked, tasksToUpdate } = getTaskTogglePlan(taskContext.tasks);

    if (tasksToUpdate.length === 0) return;

    // Map to the replacement format
    const replacements = tasksToUpdate.map((task) => ({
        from: task.from,
        to: task.to,
        text: toggleCheckboxInLine(task.lineText, targetChecked),
        expectedText: task.lineText, // Include for optimistic concurrency check
    }));

    // Send ONE IPC message
    const success = (await joplin.commands.execute('editor.execCommand', {
        name: BATCH_REPLACE_COMMAND,
        args: [replacements],
    })) as boolean;

    if (success) {
        await showToast(
            `Updated ${replacements.length} task${replacements.length !== 1 ? 's' : ''}`,
            ToastType.Success
        );
        logger.debug(`Updated ${replacements.length} tasks`);
    } else {
        await showToast('Content changed; update aborted', ToastType.Error);
        logger.warn('Batch update aborted due to content mismatch');
    }
}

/**
 * "Go to footnote" handler
 */
async function handleGoToFootnote(footnoteContext: FootnoteContext): Promise<void> {
    await joplin.commands.execute('editor.execCommand', {
        name: SCROLL_TO_POSITION_COMMAND,
        args: [footnoteContext.targetPos],
    });
    logger.debug('Scrolled to footnote definition:', footnoteContext.label);
}

/**
 * "Go to heading" handler
 * Uses Joplin's built-in jumpToHash command to navigate to headings
 */
async function handleGoToHeading(linkContext: LinkContext): Promise<void> {
    // Remove the leading # from the anchor URL
    const hash = linkContext.url.slice(1);

    const success = await joplin.commands.execute('editor.execCommand', {
        name: 'jumpToHash',
        args: [hash],
    });

    if (success) {
        logger.debug('Jumped to heading:', hash);
    } else {
        await showToast('Heading not found', ToastType.Error);
        logger.warn('Heading not found:', hash);
    }
}

/**
 * "Pin to Tabs" handler
 * Calls the Note Tabs plugin's tabsPinNote command
 */
async function handlePinToTabs(linkContext: LinkContext): Promise<void> {
    if (linkContext.type !== LinkType.JoplinResource) {
        throw new Error('Pin to tabs only works for Joplin note links');
    }

    const noteId = extractJoplinResourceId(linkContext.url);
    // Call the Note Tabs plugin command with the array signature it expects
    await joplin.commands.execute('tabsPinNote', [noteId]);
    logger.debug('Pinned note to tabs:', noteId);
}

/**
 * "Add External Link" handler
 * Opens Joplin's built-in "Insert Link" dialog
 */
async function handleAddExternalLink(): Promise<void> {
    await joplin.commands.execute('textLink');
    logger.debug('Opened Add External Link dialog');
}

/**
 * "Add Link to Note" handler
 * Opens Joplin's built-in "Link to Note" dialog
 */
async function handleAddLinkToNote(): Promise<void> {
    await joplin.commands.execute('linkToNote');
    logger.debug('Opened Add Link to Note dialog');
}

/**
 * "Fetch Link Title" handler
 * Fetches the title from an HTTP(S) URL and updates the link in the editor
 */
async function handleFetchLinkTitle(linkContext: LinkContext): Promise<void> {
    if (linkContext.type !== LinkType.ExternalUrl || linkContext.isImage) {
        throw new Error('Fetch link title only works for non-image HTTP(S) links');
    }

    const { title, isFallback } = await fetchLinkTitle(linkContext.url, {
        linkPreviewApiKey: settingsCache.linkPreviewApiKey,
    });
    const linkText = escapeMarkdownLinkText(title);

    // Build the new markdown link, updating title attribute if present
    const titlePart = linkContext.linkTitleToken
        ? ` ${buildTitleAttributeToken(linkContext.linkTitleToken, title)}`
        : '';
    const newText = `[${linkText}](${linkContext.url}${titlePart})`;

    // Determine replacement range:
    // - If markdownLinkFrom/To is set, replace the full [text](url)
    // - Otherwise, it's a bare URL, replace just the URL
    const from = linkContext.markdownLinkFrom ?? linkContext.from;
    const to = linkContext.markdownLinkTo ?? linkContext.to;

    const success = (await joplin.commands.execute('editor.execCommand', {
        name: REPLACE_RANGE_COMMAND,
        args: [newText, from, to, linkContext.expectedText],
    })) as boolean;

    if (!success) {
        throw new Error('Failed to replace link text');
    }

    if (isFallback) {
        await showToast('No title found, using domain name', ToastType.Info);
    } else {
        await showToast('Link title updated', ToastType.Success);
    }
    logger.debug('Updated link title:', title);
}

/**
 * "Fetch All Link Titles" handler
 * Fetches titles for all links in selection and updates them in a single atomic operation
 */
async function handleBatchFetchLinkTitles(ctx: LinkSelectionContext): Promise<void> {
    // Fetch all titles in parallel
    const results = await Promise.all(
        ctx.links.map(async (link) => ({
            link,
            result: await fetchLinkTitle(link.url, {
                linkPreviewApiKey: settingsCache.linkPreviewApiKey,
            }),
        }))
    );

    // Build replacements for all links (using fetched title or domain fallback)
    // Update title attribute if present
    const replacements = results.map(({ link, result }) => {
        const linkText = escapeMarkdownLinkText(result.title);
        const titlePart = link.linkTitleToken ? ` ${buildTitleAttributeToken(link.linkTitleToken, result.title)}` : '';
        return {
            from: link.markdownLinkFrom ?? link.from,
            to: link.markdownLinkTo ?? link.to,
            text: `[${linkText}](${link.url}${titlePart})`,
            expectedText: link.expectedText,
        };
    });

    // Execute batch replace (atomic operation)
    const success = (await joplin.commands.execute('editor.execCommand', {
        name: BATCH_REPLACE_COMMAND,
        args: [replacements],
    })) as boolean;

    if (!success) {
        throw new Error('Failed to update links in editor');
    }

    // Count successful title fetches (non-fallback)
    const successCount = results.filter((r) => !r.result.isFallback).length;

    await showToast(`Fetched ${successCount}/${ctx.links.length} titles`, ToastType.Success);
    logger.debug(`Batch updated ${ctx.links.length} links, ${successCount} with fetched titles`);
}

/**
 * "Open All Links" handler
 * Opens all detected HTTP(S) links in the current selection
 */
async function handleOpenAllLinksInSelection(ctx: LinkSelectionContext): Promise<void> {
    if (ctx.links.length === 0) {
        return;
    }

    let successCount = 0;
    let failureCount = 0;

    for (const link of ctx.links) {
        try {
            await joplin.commands.execute('openItem', link.url);
            successCount++;
        } catch (error) {
            failureCount++;
            logger.error(`Failed to open URL in selection: ${link.url}`, error);
        }
    }

    if (failureCount === 0) {
        await showToast(`Opened ${successCount} link${successCount !== 1 ? 's' : ''}`, ToastType.Success);
        return;
    }

    if (successCount > 0) {
        await showToast(`Opened ${successCount}/${ctx.links.length} links`, ToastType.Info);
        return;
    }

    await showToast('Failed to open links', ToastType.Error);
}
