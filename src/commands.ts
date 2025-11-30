import joplin from 'api';
import { COMMAND_IDS, LinkContext, CodeContext, LinkType } from './types';
import { showToast, ToastType } from './utils/toastUtils';
import { logger } from './logger';
import { extractJoplinResourceId } from './utils/urlUtils';

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
        name: COMMAND_IDS.COPY_PATH,
        label: 'Copy Path',
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
        name: COMMAND_IDS.REVEAL_FILE,
        label: 'Reveal File in Folder',
        execute: async (linkContext: LinkContext) => {
            try {
                await handleRevealFile(linkContext);
            } catch (error) {
                logger.error('Failed to reveal file:', error);
                await showToast('Failed to reveal file', ToastType.Error);
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
        name: COMMAND_IDS.COPY_OCR_TEXT,
        label: 'Copy OCR Text',
        execute: async (linkContext: LinkContext) => {
            try {
                await handleCopyOcrText(linkContext);
            } catch (error) {
                logger.error('Failed to copy OCR text:', error);
                await showToast('Failed to copy OCR text', ToastType.Error);
            }
        },
    });
}

/**
 * Unified "Open Link" handler
 * - External URLs: Open in browser
 * - Joplin Resources: Open in default app
 */
async function handleOpenLink(linkContext: LinkContext): Promise<void> {
    if (linkContext.type === LinkType.ExternalUrl || linkContext.type === LinkType.Email) {
        // Use Joplin's built-in command to open external URL
        await joplin.commands.execute('openItem', linkContext.url);
        logger.info('Opened external URL:', linkContext.url);
    } else if (linkContext.type === LinkType.JoplinResource) {
        // Joplin's openItem command can handle resource links directly
        await joplin.commands.execute('openItem', linkContext.url);
        logger.info('Opened resource:', linkContext.url);
    } else {
        throw new Error(`Unsupported link type: ${linkContext.type}`);
    }
}

/**
 * Unified "Copy Path" handler
 * - External URLs: Copy URL to clipboard
 * - Joplin Resources: Copy file path to clipboard
 */
async function handleCopyPath(linkContext: LinkContext): Promise<void> {
    let textToCopy: string;

    if (linkContext.type === LinkType.ExternalUrl) {
        textToCopy = linkContext.url;
        logger.info('Copying URL to clipboard:', textToCopy);
    } else if (linkContext.type === LinkType.Email) {
        textToCopy = linkContext.url.replace(/^mailto:/i, '');
        logger.info('Copying email to clipboard:', textToCopy);
    } else if (linkContext.type === LinkType.JoplinResource) {
        const resourceId = extractJoplinResourceId(linkContext.url);
        textToCopy = await joplin.data.resourcePath(resourceId);
        logger.info('Copying resource path to clipboard:', textToCopy);
    } else {
        throw new Error(`Unsupported link type: ${linkContext.type}`);
    }

    await joplin.clipboard.writeText(textToCopy);
    await showToast('Copied to clipboard', ToastType.Success);
}

/**
 * "Reveal File in Folder" handler (resources only)
 */
async function handleRevealFile(linkContext: LinkContext): Promise<void> {
    if (linkContext.type !== LinkType.JoplinResource) {
        throw new Error('Reveal file only works for Joplin resources');
    }

    const resourceId = extractJoplinResourceId(linkContext.url);

    // Use Joplin's built-in revealResourceFile command
    await joplin.commands.execute('revealResourceFile', resourceId);
    logger.info('Revealed resource file:', resourceId);
}

/**
 * "Copy Code" handler
 * Copies code content to clipboard
 */
async function handleCopyCode(codeContext: CodeContext): Promise<void> {
    await joplin.clipboard.writeText(codeContext.code);
    await showToast('Code copied to clipboard', ToastType.Success);
    logger.info('Copied code to clipboard');
}

/**
 * "Copy OCR Text" handler
 * Copies OCR text from image resources to clipboard
 */
async function handleCopyOcrText(linkContext: LinkContext): Promise<void> {
    if (linkContext.type !== LinkType.JoplinResource) {
        throw new Error('Copy OCR text only works for Joplin resources');
    }

    const resourceId = extractJoplinResourceId(linkContext.url);

    // Fetch the resource with OCR fields
    const resource = await joplin.data.get(['resources', resourceId], {
        fields: ['id', 'mime', 'ocr_text', 'ocr_status'],
    });

    if (!resource.ocr_text) {
        await showToast('No OCR text available for this image', ToastType.Error);
        logger.warn('No OCR text available for resource:', resourceId);
        return;
    }

    await joplin.clipboard.writeText(resource.ocr_text);
    await showToast('OCR text copied to clipboard', ToastType.Success);
    logger.info('Copied OCR text to clipboard for resource:', resourceId);
}
