/**
 * Represents a detected link's context information
 */
export interface LinkContext {
    /** Discriminator for union type */
    contextType: 'link';

    /** The raw link text (e.g., "https://example.com" or ":/abc123...") */
    url: string;

    /** Type of link detected */
    type: LinkType;

    /** Position information for the link */
    from: number;
    to: number;
}

/**
 * Represents a detected code block or inline code
 */
export interface CodeContext {
    /** Discriminator for union type */
    contextType: 'code';

    /** The code content */
    code: string;

    /** Position information for the code */
    from: number;
    to: number;
}

export enum LinkType {
    /** External HTTP/HTTPS URL */
    ExternalUrl = 'external-url',

    /** Joplin resource (:/resource-id format) */
    JoplinResource = 'joplin-resource',

    /** Email mailto: URL */
    Email = 'email',
}

/**
 * Union type for all context types
 */
export type EditorContext = LinkContext | CodeContext;

/**
 * Content script context provided by Joplin
 * (kept for type compatibility, but postMessage no longer used in pull architecture)
 */
export interface ContentScriptContext {
    contentScriptId: string;
}

/**
 * CodeMirror wrapper provided by Joplin content script environment
 */
export interface CodeMirrorWrapper {
    cm6: boolean;
    editor: unknown; // EditorView from @codemirror/view, but typed as unknown to avoid importing in main context
    addExtension: (extension: unknown) => void;
    registerCommand: (name: string, callback: () => unknown) => void;
}

/**
 * Command IDs - must be globally unique
 */
export const COMMAND_IDS = {
    OPEN_LINK: 'contextUtils.openLink',
    COPY_PATH: 'contextUtils.copyPath',
    REVEAL_FILE: 'contextUtils.revealFile',
    COPY_CODE: 'contextUtils.copyCode',
    COPY_OCR_TEXT: 'contextUtils.copyOcrText',
} as const;
