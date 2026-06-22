import { TaskInfo } from '../types';
import { getTaskTogglePlan } from './taskToggleUtils';

function task(checked: boolean): TaskInfo {
    const lineText = checked ? '- [x] Task' : '- [ ] Task';
    return {
        lineText,
        checked,
        from: 0,
        to: lineText.length,
    };
}

describe('getTaskTogglePlan', () => {
    it('checks unchecked-only tasks', () => {
        const tasks = [task(false), task(false)];
        const plan = getTaskTogglePlan(tasks);

        expect(plan.targetChecked).toBe(true);
        expect(plan.tasksToUpdate).toEqual(tasks);
    });

    it('unchecks checked-only tasks', () => {
        const tasks = [task(true), task(true)];
        const plan = getTaskTogglePlan(tasks);

        expect(plan.targetChecked).toBe(false);
        expect(plan.tasksToUpdate).toEqual(tasks);
    });

    it('checks only unchecked tasks in mixed selections', () => {
        const checkedTask = task(true);
        const uncheckedTask = task(false);
        const plan = getTaskTogglePlan([checkedTask, uncheckedTask]);

        expect(plan.targetChecked).toBe(true);
        expect(plan.tasksToUpdate).toEqual([uncheckedTask]);
    });
});
