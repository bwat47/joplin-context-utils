/**
 * Represents a detected link's context information
 */
export interface LinkContext {
    /** The raw link text (e.g., "https://example.com" or ":/abc123...") */
    url: string;

    /** Type of link detected */
    type: LinkType;

    /** Position information for the link */
    from: number;
    to: number;
}

export enum LinkType {
    /** External HTTP/HTTPS URL */
    ExternalUrl = 'external-url',

    /** Joplin resource (:/resource-id format) */
    JoplinResource = 'joplin-resource',

    /** Local file:// URL */
    LocalFile = 'local-file',
}

/**
 * Message types for postMessage communication
 */
export const MESSAGE_TYPES = {
    GET_LINK_CONTEXT: 'getLinkContext',
} as const;

/**
 * Command IDs - must be globally unique
 */
export const COMMAND_IDS = {
    OPEN_LINK: 'contextUtils.openLink',
    COPY_PATH: 'contextUtils.copyPath',
    REVEAL_FILE: 'contextUtils.revealFile',
} as const;
