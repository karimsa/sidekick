import * as babel from '@babel/core';
import * as esbuild from 'esbuild';

export class ExtensionBuilder {
    static async splitServerClient(code: string): Promise<{ server: string; client: string }> {
        console.time('build extension');
        const fullAst = await babel.parseAsync(code, {
            parserOpts: {
                plugins: ['typescript', 'jsx'],
                sourceType: 'module'
            }
        });

        // First determine all the server-side exports
        const serverExports: string[] = [];
        await babel.traverse(fullAst, {
            CallExpression(path) {
                const callee = path.get('callee');
                if (callee.isIdentifier() && callee.node.name === 'useQuery') {
                    const firstArg = path.get('arguments')[0];
                    if (!firstArg || !firstArg.isIdentifier()) {
                        throw firstArg.buildCodeFrameError(`The first argument to useQuery() must be an identifier`);
                    }
                    serverExports.push(firstArg.node.name);
                    firstArg.replaceWith(babel.types.stringLiteral(firstArg.node.name));
                }
            }
        });

        const [client, server] = await Promise.all([
            this.buildClientBundle({ serverExports, fullAst, code }),
            this.buildServerBundle({ fullAst, code })
        ]);
        console.timeEnd('build extension');
        return { client, server };
    }

    static async buildServerBundle({ fullAst, code }: { fullAst: babel.Node; code: string }): Promise<string> {
        const result = await esbuild.build({
            write: false,
            stdin: {
                contents: await this.removeExportsFromAst(fullAst, code, ['Page']),
                sourcefile: 'extension.server.ts',
                loader: 'tsx'
            },
            platform: 'node',
            target: 'node12',
            bundle: true,
            plugins: [
                {
                    name: 'mark-external-packages',
                    setup(build) {
                        build.onResolve({ filter: /^[^./]|^\.[^./]|^\.\.[^/]/ }, args => ({
                            path: args.path,
                            external: true
                        }));
                    }
                }
            ]
        });
        return result.outputFiles[0].text;
    }

    static async buildClientBundle({
        serverExports,
        fullAst,
        code
    }: {
        serverExports: string[];
        fullAst: babel.Node;
        code: string;
    }): Promise<string> {
        const clientCode = await this.removeExportsFromAst(fullAst, code, serverExports);
        const result = await esbuild.build({
            write: false,
            stdin: {
                contents: clientCode,
                sourcefile: 'extension.client.ts',
                loader: 'tsx'
            },
            platform: 'browser',
            bundle: true,
            plugins: [
                {
                    name: 'resolve-sidekick',
                    setup(build) {
                        build.onResolve({ filter: /^(react|sidekick)$/ }, args => {
                            return { path: args.path, external: true };
                        });
                    }
                }
            ]
        });
        return result.outputFiles[0].text;
    }

    static async removeExportsFromAst(inputAst: babel.Node, code: string, exportNames: string[]) {
        const removedExports: string[] = [];
        const { code: outputCode } = await babel.transformFromAstAsync(inputAst, code, {
            plugins: [
                {
                    visitor: {
                        ExportNamedDeclaration(path) {
                            const exports = path.get('declaration');
                            for (const exportDeclaration of Array.isArray(exports) ? exports : [exports]) {
                                switch (exportDeclaration.node.type) {
                                    case 'FunctionDeclaration':
                                        if (
                                            exportDeclaration.node.id.type === 'Identifier' &&
                                            exportNames.includes(exportDeclaration.node.id.name)
                                        ) {
                                            removedExports.push(exportDeclaration.node.id.name);
                                            path.remove();
                                        }
                                        break;

                                    case 'VariableDeclaration':
                                        for (const varDeclaration of exportDeclaration.get('declarations')) {
                                            if (
                                                varDeclaration.node.id.type === 'Identifier' &&
                                                exportNames.includes(varDeclaration.node.id.name)
                                            ) {
                                                removedExports.push(varDeclaration.node.id.name);
                                                path.remove();
                                            }
                                        }
                                        break;

                                    default:
                                        throw path.buildCodeFrameError(`Unexpected export`);
                                }
                            }
                        }
                    }
                }
            ]
        });
        if (removedExports.length !== exportNames.length) {
            throw new Error(`Failed to find exports for: ${exportNames.join(', ')}`);
        }
        return outputCode;
    }
}
