export function loadModule(code: string, globals: Record<string, any> = {}): any {
    const globalKeys = Object.keys(globals);
    const moduleLoader = new Function('module', 'exports', ...globalKeys, `(function(){ ${code} }())`);
    const moduleExports = { exports: {} as any };
    moduleLoader.apply(global, [moduleExports, moduleExports.exports, ...globalKeys.map(key => globals[key])]);
    return moduleExports.exports;
}
