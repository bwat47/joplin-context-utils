import joplin from 'api';
import { ContentScriptType } from 'api/types';
import { registerCommands } from './commands';
import { registerApplicationMenuItems, registerContextMenuFilter, CONTENT_SCRIPT_ID } from './menus';
import { registerSettings, initializeSettingsCache, readSettingValue } from './settings';
import { GET_CONTENT_SCRIPT_SETTINGS_MESSAGE, ContentScriptMessage, ContentScriptSettings } from './types';
import { logger } from './logger';

joplin.plugins.register({
    onStart: async function () {
        logger.debug('Context Utils plugin starting...');

        try {
            // 1. Register settings
            await registerSettings();
            logger.debug('Settings registered');

            // 2. Initialize settings cache
            await initializeSettingsCache();
            logger.debug('Settings cache initialized');

            // Serve settings the content script needs (it fetches them once on load).
            // Registered before the content script so an already-open editor never posts before a handler exists.
            // Values are read from Joplin rather than the cache: the editor reloads when the Options screen
            // closes, which can happen before onChange has refreshed the cache.
            await joplin.contentScripts.onMessage(CONTENT_SCRIPT_ID, async (message: ContentScriptMessage) => {
                if (message?.type === GET_CONTENT_SCRIPT_SETTINGS_MESSAGE) {
                    const settings: ContentScriptSettings = {
                        cleanListMarkersOnPaste: await readSettingValue('cleanListMarkersOnPaste'),
                    };
                    return settings;
                }
                return undefined;
            });

            // 3. Register content script for link detection
            await joplin.contentScripts.register(
                ContentScriptType.CodeMirrorPlugin,
                CONTENT_SCRIPT_ID,
                './contentScripts/contentScript.js' // .js extension (webpack output)
            );
            logger.debug('Link detection content script registered');

            // 4. Register commands
            await registerCommands();
            logger.debug('Commands registered');

            // 5. Register context menu filter
            registerContextMenuFilter();
            logger.debug('Context menu filter registered');

            // 6. Register application menu items
            await registerApplicationMenuItems();
            logger.debug('Application menu items registered');

            logger.debug('Context Utils plugin started successfully');
        } catch (error) {
            logger.error('Failed to start Context Utils plugin:', error);
            throw error;
        }
    },
});
