/**
 * Utility functions for checkbox manipulation in task lists
 */

/**
 * Checks a checkbox in a task list line
 * @param lineText - The complete line text containing the checkbox
 * @returns The line text with the checkbox checked
 *
 * @example
 * checkCheckboxInLine('- [ ] Task') // Returns: '- [x] Task'
 */
export function checkCheckboxInLine(lineText: string): string {
    return lineText.replace(/\[ \]/, '[x]');
}

/**
 * Unchecks a checkbox in a task list line.
 * @example
 * uncheckCheckboxInLine('- [x] Done') // Returns: '- [ ] Done'
 */
export function uncheckCheckboxInLine(lineText: string): string {
    return lineText.replace(/\[x\]/, '[ ]');
}
