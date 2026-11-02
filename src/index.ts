import joplin from 'api';
import { ContentScriptType } from 'api/types';
import { registerCommands } from './commands';
import { logger } from './logger';
import { CONTENT_SCRIPT_ID, registerApplicationMenuItems, registerContextMenuFilter } from './menus';
import { getSetting, registerSettings } from './settings';
import type { ContentScriptSettings } from './types';
import { registerViewerContentScript } from './viewerContextMenu';

void joplin.plugins.register({
    onStart: async function () {
        try {
            await registerSettings();

            // Serve settings the content script needs (it fetches them once on load).
            // Registered before the content script so an already-open editor never posts before a handler exists.
            // The only message the content script sends is a settings request, so no type check is needed.
            await joplin.contentScripts.onMessage(CONTENT_SCRIPT_ID, async (): Promise<ContentScriptSettings> => {
                return {
                    cleanUpListPaste: await getSetting('cleanUpListPaste'),
                };
            });

            await joplin.contentScripts.register(
                ContentScriptType.CodeMirrorPlugin,
                CONTENT_SCRIPT_ID,
                './contentScripts/editor/contentScript.js'
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
