import React from 'react';

export function useLocalState<T>(
    name: string,
    castType: (value: string) => T
): [T | undefined, (value?: T | null) => void] {
    const [value, setState] = React.useState<T | undefined>(() => {
        const cachedValue = global.localStorage?.getItem(name);
        if (cachedValue == null) {
            return undefined;
        }
        return castType(JSON.parse(cachedValue));
    });
    return [
        value,
        nextValue => {
            if (nextValue == null) {
                localStorage.removeItem(name);
            } else {
                localStorage.setItem(name, JSON.stringify(nextValue));
            }
            setState(nextValue ?? undefined);
        }
    ];
}
