/**
 * Utility functions for checkbox manipulation in task lists
 */

/**
 * Matches a task list checkbox at the start of a line.
 * Allows optional leading blockquote markers (e.g. `> - [ ] Task`, including
 * nested `> > `) and indentation before the list marker.
 * Group 1: the full prefix up to the checkbox. Group 2: the checkbox state char.
 */
export const TASK_CHECKBOX_PATTERN = /^(\s*(?:>\s*)*[-*+]\s+)\[([x ])\]/;

// Same prefix as TASK_CHECKBOX_PATTERN, restricted to one checkbox state.
// e.g. "  > - [ ] Task [ ]" matches only the first "[ ]".
const UNCHECKED_TASK_PATTERN = /^(\s*(?:>\s*)*[-*+]\s+)\[ \]/;
const CHECKED_TASK_PATTERN = /^(\s*(?:>\s*)*[-*+]\s+)\[x\]/;

/**
 * Checks the task checkbox in a task list line. Other brackets in the line are left unchanged.
 * @param lineText - The complete line text containing the checkbox
 * @returns The line text with the checkbox checked
 *
 * @example
 * checkCheckboxInLine('- [ ] Task') // Returns: '- [x] Task'
 */
export function checkCheckboxInLine(lineText: string): string {
    return lineText.replace(UNCHECKED_TASK_PATTERN, '$1[x]');
}

/**
 * Unchecks the task checkbox in a task list line. Other brackets in the line are left unchanged.
 * @example
 * uncheckCheckboxInLine('- [x] Done') // Returns: '- [ ] Done'
 */
export function uncheckCheckboxInLine(lineText: string): string {
    return lineText.replace(CHECKED_TASK_PATTERN, '$1[ ]');
}
