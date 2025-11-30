import joplin from 'api';
import { LinkContext, LinkType, COMMAND_IDS, MESSAGE_TYPES, ContentScriptMessage } from './types';
import { MenuItem } from 'api/types';
import { logger } from './utils/logger';

const CONTENT_SCRIPT_ID = 'contextUtilsLinkDetection';

// Store the current link context received from content script
let currentLinkContext: LinkContext | null = null;

/**
 * Sets up message listener for content script updates
 */
export async function setupMessageListener(): Promise<void> {
    await joplin.contentScripts.onMessage(CONTENT_SCRIPT_ID, (message: ContentScriptMessage) => {
        if (message.type === MESSAGE_TYPES.GET_LINK_CONTEXT) {
            currentLinkContext = message.data;
            logger.debug('Link context updated:', currentLinkContext);
        }
    });
}

/**
 * Registers context menu filter
 * This is called BEFORE the context menu opens
 */
export async function registerContextMenuFilter(): Promise<void> {
    await joplin.workspace.filterEditorContextMenu(async (menuItems) => {
        try {
            // Use the stored link context from content script
            const linkContext = currentLinkContext;

            if (!linkContext) {
                // No link at cursor, return menu unchanged
                return menuItems;
            }

            logger.debug('Building context menu for link:', linkContext);

            // Add separator before our items
            const separator: MenuItem = { type: 'separator' };

            // Build menu items based on link type
            const contextMenuItems: MenuItem[] = [
                separator,
                {
                    commandName: COMMAND_IDS.OPEN_LINK,
                    commandArgs: [linkContext],
                    label: getLabelForOpenLink(linkContext),
                },
                {
                    commandName: COMMAND_IDS.COPY_PATH,
                    commandArgs: [linkContext],
                    label: getLabelForCopyPath(linkContext),
                },
            ];

            // Add "Reveal File" only for Joplin resources
            if (linkContext.type === LinkType.JoplinResource) {
                contextMenuItems.push({
                    commandName: COMMAND_IDS.REVEAL_FILE,
                    commandArgs: [linkContext],
                    label: 'Reveal File in Folder',
                });
            }

            // Return original items plus our additions
            return {
                items: [...menuItems.items, ...contextMenuItems],
            };
        } catch (error) {
            logger.error('Error in context menu filter:', error);
            // Return original menu on error to avoid breaking context menu
            return menuItems;
        }
    });
}

/**
 * Generates context-aware label for "Open Link" command
 */
function getLabelForOpenLink(linkContext: LinkContext): string {
    switch (linkContext.type) {
        case LinkType.ExternalUrl:
            return 'Open Link in Browser';
        case LinkType.JoplinResource:
            return 'Open Resource';
        default:
            return 'Open Link';
    }
}

/**
 * Generates context-aware label for "Copy Path" command
 */
function getLabelForCopyPath(linkContext: LinkContext): string {
    switch (linkContext.type) {
        case LinkType.ExternalUrl:
            return 'Copy URL';
        case LinkType.JoplinResource:
            return 'Copy Resource Path';
        default:
            return 'Copy Path';
    }
}

export { CONTENT_SCRIPT_ID };
