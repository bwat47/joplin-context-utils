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
export const SETTING_SHOW_OPEN_LINK = 'contextUtils.showOpenLink';
export const SETTING_SHOW_COPY_PATH = 'contextUtils.showCopyPath';
export const SETTING_SHOW_REVEAL_FILE = 'contextUtils.showRevealFile';
export const SETTING_SHOW_COPY_CODE = 'contextUtils.showCopyCode';
export const SETTING_SHOW_COPY_OCR_TEXT = 'contextUtils.showCopyOcrText';

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
        [SETTING_SHOW_OPEN_LINK]: {
            value: true,
            type: SettingItemType.Bool,
            section: SECTION_ID,
            public: true,
            label: 'Show "Open Link" in context menu',
            description: 'Display option to open external URLs in browser or Joplin resources in default app',
        },
        [SETTING_SHOW_COPY_PATH]: {
            value: true,
            type: SettingItemType.Bool,
            section: SECTION_ID,
            public: true,
            label: 'Show "Copy Path" in context menu',
            description: 'Display option to copy URL or resource file path to clipboard',
        },
        [SETTING_SHOW_REVEAL_FILE]: {
            value: true,
            type: SettingItemType.Bool,
            section: SECTION_ID,
            public: true,
            label: 'Show "Reveal File" in context menu',
            description: 'Display option to reveal Joplin resource files in file explorer',
        },
        [SETTING_SHOW_COPY_CODE]: {
            value: true,
            type: SettingItemType.Bool,
            section: SECTION_ID,
            public: true,
            label: 'Show "Copy Code" in context menu',
            description: 'Display option to copy code from inline code or code blocks to clipboard',
        },
        [SETTING_SHOW_COPY_OCR_TEXT]: {
            value: true,
            type: SettingItemType.Bool,
            section: SECTION_ID,
            public: true,
            label: 'Show "Copy OCR Text" in context menu',
            description: 'Display option to copy OCR text from image resources when available',
        },
    });
}
