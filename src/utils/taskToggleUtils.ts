import { TaskInfo } from '../types';

export interface TaskTogglePlan {
    targetChecked: boolean;
    tasksToUpdate: TaskInfo[];
}

/**
 * Determines which tasks should change for the unified task toggle action.
 *
 * If any task is unchecked, the action checks unchecked tasks only. If all
 * tasks are checked, the action unchecks all checked tasks.
 */
export function getTaskTogglePlan(tasks: TaskInfo[]): TaskTogglePlan {
    const targetChecked = tasks.some((task) => !task.checked);
    return {
        targetChecked,
        tasksToUpdate: tasks.filter((task) => task.checked !== targetChecked),
    };
}
