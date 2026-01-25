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

    /** If this is a markdown link [text](url), these track the full link range */
    markdownLinkFrom?: number;
    markdownLinkTo?: number;

    /** True if this is a reference-style link [text][ref] */
    isReferenceLink?: boolean;

    /** Optional raw title attribute token from markdown link [text](url "title") */
    linkTitleToken?: string;

    /** Expected text for optimistic concurrency checks */
    expectedText?: string;
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

/**
 * Represents a detected task list checkbox
 */
export interface CheckboxContext {
    /** Discriminator for union type */
    contextType: 'checkbox';

    /** Whether the checkbox is currently checked */
    checked: boolean;

    /** The full line text containing the checkbox */
    lineText: string;

    /** Position information for the checkbox line */
    from: number;
    to: number;
}

/**
 * Represents information about a single task in a selection
 */
export interface TaskInfo {
    /** Line text */
    lineText: string;

    /** Whether the task is checked */
    checked: boolean;

    /** Position of the line */
    from: number;
    to: number;
}

/**
 * Represents multiple task list checkboxes in a selection
 */
export interface TaskSelectionContext {
    /** Discriminator for union type */
    contextType: 'taskSelection';

    /** Array of tasks found in the selection */
    tasks: TaskInfo[];

    /** Number of checked tasks */
    checkedCount: number;

    /** Number of unchecked tasks */
    uncheckedCount: number;

    /** Position information for the entire selection */
    from: number;
    to: number;
}

/**
 * Represents a detected footnote reference
 */
export interface FootnoteContext {
    /** Discriminator for union type */
    contextType: 'footnote';

    /** The footnote label (e.g., "1" from "[^1]") */
    label: string;

    /** The target position (start of the definition line) */
    targetPos: number;

    /** Position information for the footnote reference */
    from: number;
    to: number;
}

/**
 * Represents information about a single link in a selection (for batch operations)
 */
export interface LinkInfo {
    /** The URL */
    url: string;

    /** Link type */
    type: LinkType;

    /** URL position within the document */
    from: number;
    to: number;

    /** If this is a markdown link [text](url), these track the full link range */
    markdownLinkFrom?: number;
    markdownLinkTo?: number;

    /** Optional raw title attribute token from markdown link [text](url "title") */
    linkTitleToken?: string;

    /** Expected text for optimistic concurrency checks */
    expectedText?: string;
}

/**
 * Represents multiple links in a selection (for batch title fetching)
 */
export interface LinkSelectionContext {
    /** Discriminator for union type */
    contextType: 'linkSelection';

    /** Array of links found in the selection */
    links: LinkInfo[];

    /** Position information for the entire selection */
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

    /** Internal anchor link (#heading) */
    InternalAnchor = 'internal-anchor',
}

export type EditorContext =
    | LinkContext
    | CodeContext
    | CheckboxContext
    | TaskSelectionContext
    | FootnoteContext
    | LinkSelectionContext;

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
    registerCommand: (name: string, callback: (...args: unknown[]) => unknown) => void;
}

/**
 * Command IDs - must be globally unique
 */
export const COMMAND_IDS = {
    OPEN_LINK: 'contextUtils.openLink',
    ADD_EXTERNAL_LINK: 'contextUtils.addExternalLink',
    ADD_LINK_TO_NOTE: 'contextUtils.addLinkToNote',
    COPY_PATH: 'contextUtils.copyPath',
    REVEAL_FILE: 'contextUtils.revealFile',
    COPY_CODE: 'contextUtils.copyCode',
    COPY_OCR_TEXT: 'contextUtils.copyOcrText',
    TOGGLE_CHECKBOX: 'contextUtils.toggleCheckbox',
    CHECK_ALL_TASKS: 'contextUtils.checkAllTasks',
    UNCHECK_ALL_TASKS: 'contextUtils.uncheckAllTasks',
    GO_TO_FOOTNOTE: 'contextUtils.goToFootnote',
    GO_TO_HEADING: 'contextUtils.goToHeading',
    PIN_TO_TABS: 'contextUtils.pinToTabs',
    OPEN_NOTE_NEW_WINDOW: 'contextUtils.openNoteNewWindow',
    FETCH_LINK_TITLE: 'contextUtils.fetchLinkTitle',
    FETCH_ALL_LINK_TITLES: 'contextUtils.fetchAllLinkTitles',
} as const;

/**
 * Editor range for text replacement operations
 */
export interface EditorRange {
    from: number;
    to: number;
}
