import React, { useCallback, useState } from 'react';

export function useLocalState<T>(
	name: string,
	castType: (value: string) => T,
): [
	T | undefined,
	(value?: T | null | ((value: T | null) => T | null)) => void,
] {
	const [value, setState] = useState<T | undefined>(() => {
		const cachedValue = global.localStorage?.getItem(name);
		if (cachedValue == null) {
			return undefined;
		}
		return castType(JSON.parse(cachedValue));
	});

	const setLocalState = useCallback(
		(nextValue: T | null | ((value: T | null) => T | null)) => {
			if (typeof nextValue === 'function') {
				return setLocalState(nextValue(value));
			}

			if (nextValue == null) {
				localStorage.removeItem(name);
			} else {
				localStorage.setItem(name, JSON.stringify(nextValue));
			}
			setState(
				typeof nextValue === 'function'
					? nextValue(value)
					: nextValue ?? undefined,
			);
		},
		[name, value],
	);

	return [value, setLocalState];
}
