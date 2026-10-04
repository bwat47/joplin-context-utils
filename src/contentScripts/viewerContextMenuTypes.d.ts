import type { ViewerTask } from '../viewerTasks';

/** Local access to the viewer environment, without global declarations. */
export type ViewerWindow = Window & {
    contextUtilsViewerContextMenuLoaded?: boolean;
};

export interface ViewerContextMenuMessage {
    tasks: ViewerTask[] | null;
    clickedAt: number;
}

export interface ViewerWebviewApi {
    postMessage(contentScriptId: string, message: ViewerContextMenuMessage): Promise<unknown>;
}
