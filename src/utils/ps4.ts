export function isPs4Browser(userAgent: string): boolean {
    return /\bPlayStation 4\b/i.test(userAgent);
}
