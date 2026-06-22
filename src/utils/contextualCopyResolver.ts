import { CodeContext, EditorContext, HeadingContext, LinkContext, LinkType, QuoteContext } from '../types';

export type ContextualCopyTarget =
    | { kind: 'code'; context: CodeContext }
    | { kind: 'link'; context: LinkContext }
    | { kind: 'heading'; context: HeadingContext }
    | { kind: 'quote'; context: QuoteContext };

export function resolveContextualCopyTarget(contexts: EditorContext[]): ContextualCopyTarget | null {
    const codeContext = contexts.find((context): context is CodeContext => context.contextType === 'code');
    if (codeContext) {
        return { kind: 'code', context: codeContext };
    }

    const linkContext = contexts.find(
        (context): context is LinkContext =>
            context.contextType === 'link' && (context.type === LinkType.ExternalUrl || context.type === LinkType.Email)
    );
    if (linkContext) {
        return { kind: 'link', context: linkContext };
    }

    const headingContext = contexts.find((context): context is HeadingContext => context.contextType === 'heading');
    if (headingContext) {
        return { kind: 'heading', context: headingContext };
    }

    const quoteContext = contexts.find((context): context is QuoteContext => context.contextType === 'quote');
    if (quoteContext) {
        return { kind: 'quote', context: quoteContext };
    }

    return null;
}
