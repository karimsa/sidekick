import React from 'react';

const debugHookVals = new Map();

/**
 * Identify when hook values change. The react profiler only
 * figures out what props changed and it can't introspect the values.
 * This hook is useful for debugging nested value changes.
 * @param {String} name the name of your component
 * @param {Object} object an object containing all your hook values to watch
 */
function _debugHooksChanged(fnId: string, values: { [k: string]: any }) {
	if (!debugHookVals.has(fnId)) {
		debugHookVals.set(fnId, new Map());
	}

	React.useEffect(() => {
		console.log(`${fnId} mounted`);
		return () => console.log(`${fnId} unmounted`);
	}, [fnId]);

	let firstRender = false;
	const changed = [];
	const hookVals = debugHookVals.get(fnId);
	for (const [key, val] of Object.entries(values)) {
		firstRender = !hookVals.has(key);
		if (hookVals.get(key) !== val) {
			changed.push(key);
		}
		hookVals.set(key, val);
	}

	if (firstRender) {
		console.debug(`${fnId} initial render`);
	} else if (changed.length) {
		console.log(`${fnId} Hooks changed: [${changed}]`);
	}
}

export const debugHooksChanged =
	process.env.NODE_ENV === 'production'
		? /* #__PURE__ */ function () {}
		: _debugHooksChanged;
