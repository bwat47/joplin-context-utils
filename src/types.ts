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
 * Message interface for content script communication
 */
export interface ContentScriptMessage {
    type: typeof MESSAGE_TYPES.GET_LINK_CONTEXT;
    data: LinkContext | null;
}

/**
 * Content script context provided by Joplin
 */
export interface ContentScriptContext {
    contentScriptId: string;
    postMessage: (message: ContentScriptMessage) => void;
}

/**
 * CodeMirror wrapper provided by Joplin content script environment
 */
export interface CodeMirrorWrapper {
    cm6: boolean;
    editor: unknown; // EditorView from @codemirror/view, but typed as unknown to avoid importing in main context
    addExtension: (extension: unknown) => void;
}

/**
 * Command IDs - must be globally unique
 */
export const COMMAND_IDS = {
    OPEN_LINK: 'contextUtils.openLink',
    COPY_PATH: 'contextUtils.copyPath',
    REVEAL_FILE: 'contextUtils.revealFile',
} as const;
