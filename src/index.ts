import joplin from 'api';
import { ContentScriptType } from 'api/types';
import { registerCommands } from './commands';
import { registerContextMenuFilter, setupMessageListener, CONTENT_SCRIPT_ID } from './menus';
import { logger } from './utils/logger';

joplin.plugins.register({
    onStart: async function () {
        logger.info('Context Utils plugin starting...');

        try {
            // 1. Register content script for link detection
            await joplin.contentScripts.register(
                ContentScriptType.CodeMirrorPlugin,
                CONTENT_SCRIPT_ID,
                './contentScripts/linkDetection.js' // .js extension (webpack output)
            );
            logger.info('Link detection content script registered');

            // 2. Set up message listener to receive updates from content script
            await setupMessageListener();
            logger.info('Content script message listener registered');

            // 3. Register commands
            await registerCommands();
            logger.info('Commands registered');

            // 4. Register context menu filter
            await registerContextMenuFilter();
            logger.info('Context menu filter registered');

            logger.info('Context Utils plugin started successfully');
        } catch (error) {
            logger.error('Failed to start Context Utils plugin:', error);
            throw error;
        }
    },
});
