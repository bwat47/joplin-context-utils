/**
 * "Resource Properties" flow: shows a resource's properties and applies a rename to the
 * resource's title and filename, and optionally to the label of the link that was clicked.
 *
 * Only the clicked link in the current note is updated; links in other notes are left as-is.
 */

import joplin from 'api';
import { BATCH_REPLACE_COMMAND } from '../contentScripts/editor/contentScript';
import { logger } from '../logger';
import type { LinkContext, LinkLabel, TextReplacement, TextReplacementGuard } from '../types';
import { showToast, ToastType } from '../utils/toastUtils';
import { extractJoplinResourceId } from '../utils/urlUtils';
import {
    buildLinkLabelReplacement,
    buildRenamedResourceFields,
    fetchReferencingNotes,
    fetchResourceProperties,
    getResourceDisplayName,
    isDefaultLinkLabel,
    renameResource,
    type ResourceProperties,
} from './resourceData';
import type { ResourcePropertiesPrompt } from './resourcePropertiesDialog';

function getLinkReplacementGuard(context: LinkContext): TextReplacementGuard | undefined {
    const range =
        context.htmlImageRange ??
        (context.markdownLinkFrom !== undefined && context.markdownLinkTo !== undefined
            ? { from: context.markdownLinkFrom, to: context.markdownLinkTo }
            : undefined);
    if (!context.noteId || !range || context.expectedText === undefined) return undefined;
    return { noteId: context.noteId, ...range, expectedText: context.expectedText };
}

/** True when the link label still shows the resource's own name, so a rename should update it too. */
function isResourceNameLabel(linkLabel: LinkLabel, resource: ResourceProperties): boolean {
    return linkLabel.format
        ? !linkLabel.plainText || [resource.title, resource.filename].includes(linkLabel.plainText)
        : isDefaultLinkLabel(linkLabel.text, resource);
}

/** True when the link label already shows `name`, so no replacement is needed. */
function labelMatchesName(linkLabel: LinkLabel, name: string, newLabel: string): boolean {
    return linkLabel.format ? linkLabel.plainText === name : linkLabel.text === newLabel;
}

export async function editResourceProperties(
    linkContext: LinkContext,
    prompt: ResourcePropertiesPrompt
): Promise<void> {
    const resourceId = extractJoplinResourceId(linkContext.url);
    const [resource, referencingNotes] = await Promise.all([
        fetchResourceProperties(resourceId),
        fetchReferencingNotes(resourceId),
    ]);

    const linkLabel = linkContext.linkLabel;
    const guard = getLinkReplacementGuard(linkContext);
    const result = await prompt({
        resource,
        referencingNotes,
        canUpdateLinkLabel: linkLabel !== undefined && guard !== undefined,
        updateLinkLabelByDefault:
            linkLabel !== undefined && guard !== undefined && isResourceNameLabel(linkLabel, resource),
    });
    if (!result) return;

    if (!result.name) {
        await showToast('Resource name cannot be empty', ToastType.Error);
        return;
    }

    const renamed = result.name !== getResourceDisplayName(resource);
    if (renamed) {
        await renameResource(resourceId, buildRenamedResourceFields(result.name, resource.fileExtension));
        logger.debug('Renamed resource:', resourceId, result.name);
    }

    const newLabel = linkLabel ? buildLinkLabelReplacement(result.name, linkLabel) : '';
    if (!result.updateLinkLabel || !linkLabel || !guard || labelMatchesName(linkLabel, result.name, newLabel)) {
        if (renamed) await showToast('Resource renamed', ToastType.Success);
        return;
    }

    const replacement: TextReplacement = {
        from: linkLabel.from,
        to: linkLabel.to,
        text: newLabel,
        expectedText: linkLabel.text,
    };
    const updated = (await joplin.commands.execute('editor.execCommand', {
        name: BATCH_REPLACE_COMMAND,
        args: [[replacement], guard],
    })) as boolean;

    if (!updated) {
        logger.warn('Link text update aborted due to content mismatch');
        await showToast(
            renamed
                ? 'Resource renamed; note changed, so link text was not updated'
                : 'Content changed; update aborted',
            ToastType.Info
        );
        return;
    }

    await showToast(renamed ? 'Resource and link text renamed' : 'Link text updated', ToastType.Success);
}
