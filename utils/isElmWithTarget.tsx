/**
 * Checks to see if {current} exists within {target}.
 * @params {HTMLElement} current
 * @params {HTMLElement} target
 * @returns true if {current} exists within the {target}
 */
export function isElmWithinTarget(current: HTMLElement, target: HTMLElement): boolean {
    if (target === current) {
        return true;
    }
    if (current.parentElement) {
        return isElmWithinTarget(current.parentElement, target);
    }
    return false;
}
