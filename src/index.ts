import joplin from 'api';
import { ContentScriptType } from 'api/types';
import { registerCommands } from './commands';
import { registerContextMenuFilter, CONTENT_SCRIPT_ID } from './menus';
import { registerSettings, initializeSettingsCache } from './settings';
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

            logger.debug('Context Utils plugin started successfully');
        } catch (error) {
            logger.error('Failed to start Context Utils plugin:', error);
            throw error;
        }
    },
});
