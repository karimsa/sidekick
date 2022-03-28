/**
 * Checks to see if {current} exists within {target}.
 * @params {HTMLElement} current
 * @params {HTMLElement} target
 * @returns true if {current} exists within the {target}
 */
export function isElmWithinTarget(
	current: Element,
	target: Element | null,
): boolean {
	if (!target) {
		return false;
	}
	if (target === current) {
		return true;
	}
	if (current.parentElement) {
		return isElmWithinTarget(current.parentElement, target);
	}
	return false;
}
