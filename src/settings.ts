/**
 * Joplin settings registration for Context Utils plugin.
 *
 * Integrates plugin configuration into Joplin's preferences UI, allowing
 * users to customize plugin behavior through Settings > Context Utils.
 */

import joplin from 'api';
import { SettingItemType } from 'api/types';

const SECTION_ID = 'contextUtils';

export const SETTING_SHOW_TOAST_MESSAGES = 'contextUtils.showToastMessages';

export async function registerSettings(): Promise<void> {
    await joplin.settings.registerSection(SECTION_ID, {
        label: 'Context Utils',
        iconName: 'fas fa-mouse-pointer',
    });

    await joplin.settings.registerSettings({
        [SETTING_SHOW_TOAST_MESSAGES]: {
            value: true,
            type: SettingItemType.Bool,
            section: SECTION_ID,
            public: true,
            label: 'Show toast notifications',
            description: 'Display brief notification messages for plugin actions (e.g., "Copied to clipboard")',
        },
    });
}
