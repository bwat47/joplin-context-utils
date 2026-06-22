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

    /** True if this is an image embed (markdown or HTML img tag) */
    isImage?: boolean;
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
 * Represents one or more task list items that can be toggled together
 */
export interface TaskContext {
    /** Discriminator for union type */
    contextType: 'task';

    /** Array of tasks found at the cursor or within the selection */
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
 * Represents a detected markdown heading at the cursor
 */
export interface HeadingContext {
    /** Discriminator for union type */
    contextType: 'heading';

    /** The normalized heading text (formatting marks stripped) */
    headingText: string;

    /** The unique anchor/slug for the heading (matches Joplin's rendered heading ID) */
    headingAnchor: string;

    /** Position information for the heading node */
    from: number;
    to: number;
}

/**
 * Represents a detected markdown block quote at the cursor
 */
export interface QuoteContext {
    /** Discriminator for union type */
    contextType: 'quote';

    /** The quote content with quote markers removed */
    quoteText: string;

    /** Position information for the block quote node */
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
    | TaskContext
    | FootnoteContext
    | LinkSelectionContext
    | HeadingContext
    | QuoteContext;

/**
 * Command IDs - must be globally unique
 */
export const COMMAND_IDS = {
    OPEN_LINK: 'contextUtils.openLink',
    ADD_EXTERNAL_LINK: 'contextUtils.addExternalLink',
    ADD_LINK_TO_NOTE: 'contextUtils.addLinkToNote',
    COPY_PATH: 'contextUtils.copyPath',
    COPY_CODE: 'contextUtils.copyCode',
    TOGGLE_CHECKBOX: 'contextUtils.toggleCheckbox',
    GO_TO_FOOTNOTE: 'contextUtils.goToFootnote',
    GO_TO_HEADING: 'contextUtils.goToHeading',
    PIN_TO_TABS: 'contextUtils.pinToTabs',
    FETCH_LINK_TITLE: 'contextUtils.fetchLinkTitle',
    FETCH_ALL_LINK_TITLES: 'contextUtils.fetchAllLinkTitles',
    OPEN_ALL_LINKS_IN_SELECTION: 'contextUtils.openAllLinksInSelection',
    COPY_HEADING_LINK_INTERNAL: 'contextUtils.copyHeadingLinkInternal',
    COPY_HEADING_LINK_EXTERNAL: 'contextUtils.copyHeadingLinkExternal',
    COPY_QUOTE: 'contextUtils.copyQuote',
} as const;

/**
 * Editor range for text replacement operations
 */
export interface EditorRange {
    from: number;
    to: number;
}
