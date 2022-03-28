/**
 * Type-safe version of `Object.keys()`
 */
export function objectKeys<T>(object: T): (keyof T)[] {
	return Object.keys(object) as any[];
}

type Defined<T> = T extends undefined ? never : T;

type Entries<T> = Defined<
	{
		[K in keyof T]: [K, T[K]];
	}[keyof T]
>[];

/**
 * Type-safe version of `Object.entries()`
 */
export function objectEntries<T>(object: T): Entries<T> {
	return Object.entries(object) as any[];
}

/**
 * Type-safe version of `Object.assign()`
 */
export function objectAssign<T extends object>(
	object: T,
	...values: Partial<T>[]
): T {
	return Object.assign(object, ...values);
}

export function assertUnreachable(value: never) {
	return value;
}
