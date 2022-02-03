/**
 * Utility type for getting the keys of an object with a specific type
 * @example:
 *  type MyType = { a: number, b: string };
 *  const NumberKeys: KeysWithValueType<MyType, number> = 'a';
 *  const StringKeys: KeysWithValueType<MyType, string> = 'b';
 */
export type KeysWithValueType<Obj extends Record<string, any>, ValueType> = {
    [K in keyof Obj]: K extends string ? (Obj[K] extends ValueType ? K : ValueType extends Obj[K] ? K : never) : never;
}[keyof Obj];

export type Optional<Type, Keys extends keyof Type> = Omit<Type, Keys> & Partial<Type>;

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
export function objectAssign<T extends object>(object: T, ...values: Partial<T>[]): T {
    return Object.assign(object, ...values);
}

/**
 * Picks keys from O that are compatible with V.
 * @example
 * ```typescript
 * interface Foo {
 *     w: string,
 *     x: 'a' | 'b',
 *     y?: string,
 *     z: number
 * }
 *
 * type FooStrings = ObjectKeysMatching<Foo, string>; // "w" | "x"
 * type FooStringsOrUndef = ObjectKeysMatching<Foo, string | undefined>; // "w" | "x" | "y"
 * ```
 */
export type ObjectKeysMatching<O extends {}, V> = { [K in keyof O]-?: O[K] extends V ? K : never }[keyof O];

export type Falsy = false | 0 | '' | null | undefined;

/**
 * Makes any nullable key optional
 * @example
 * ```
 * type Test = { name: string; archived_at: Date | null };
 * // The example type is now: { name: string; archived_at?: Date | null }
 * const example: NullableKeysToOptional<Test> = { name: 'test', archived_at: undefined };
 * ```
 */
export type NullableKeysToOptional<O extends {}> = Partial<Pick<O, KeysWithValueType<O, null>>> &
    Pick<O, Exclude<keyof O, KeysWithValueType<O, null>>>;

/**
 * Typescript 4.5 adds Awaited to the language builtins https://github.com/microsoft/TypeScript/pull/45350
 * but we're apparently not on 4.5 yet.
 * Feel free to delete this when we upgrade.
 */
export type Awaited<T> = T extends PromiseLike<infer U> ? U : T;

/**
 * Type-safe version of lodash.keyBy
 */
export function keyBy<T>(users: T[], getId: (val: T) => string | undefined): Record<string, T> {
    const entries: Record<string, T> = {};
    for (const user of users) {
        const id = getId(user);
        if (id) {
            entries[id] = user;
        }
    }
    return entries;
}
