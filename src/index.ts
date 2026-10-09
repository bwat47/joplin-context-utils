import joplin from 'api';
import { ContentScriptType } from 'api/types';
import { registerCommands } from './commands';
import { registerApplicationMenuItems, registerContextMenuFilter, CONTENT_SCRIPT_ID } from './menus';
import { registerSettings, getSetting } from './settings';
import { GET_CONTENT_SCRIPT_SETTINGS_MESSAGE, type ContentScriptMessage, type ContentScriptSettings } from './types';
import { logger } from './logger';
import { registerViewerContentScript } from './viewerContextMenu';

void joplin.plugins.register({
    onStart: async function () {
        try {
            await registerSettings();

            // Serve settings the content script needs (it fetches them once on load).
            // Registered before the content script so an already-open editor never posts before a handler exists.
            await joplin.contentScripts.onMessage(CONTENT_SCRIPT_ID, async (message: ContentScriptMessage) => {
                if (message?.type === GET_CONTENT_SCRIPT_SETTINGS_MESSAGE) {
                    const settings: ContentScriptSettings = {
                        cleanUpListPaste: await getSetting('cleanUpListPaste'),
                    };
                    return settings;
                }
                return undefined;
            });

            await joplin.contentScripts.register(
                ContentScriptType.CodeMirrorPlugin,
                CONTENT_SCRIPT_ID,
                './contentScripts/contentScript.js'
            );

            await registerViewerContentScript();

            await registerCommands();

            registerContextMenuFilter();

            await registerApplicationMenuItems();
        } catch (error) {
            logger.error('Failed to start Context Utils plugin:', error);
            throw error;
        }
    },
});
