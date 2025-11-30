/**
 * Extracts the resource ID from a Joplin resource URL
 * @param url - Joplin resource URL (format: :/32-hex-id)
 * @returns The 32-character hex ID
 * @example
 * extractJoplinResourceId(':/c188011f98504be1b60bb72ccd7c2ce5')
 * // Returns: 'c188011f98504be1b60bb72ccd7c2ce5'
 */
export function extractJoplinResourceId(url: string): string {
    return url.substring(2); // Remove ":/" prefix
}
