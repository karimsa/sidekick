import * as childProcess from 'child_process';
import * as os from 'os';
import createDebug from 'debug';
import treeKill from 'tree-kill';
import * as fs from 'fs';
import * as path from 'path';
import * as tmp from 'tmp-promise';
import getNextConfig from 'next/config';

import { fmt } from './fmt';
import { ConfigManager } from '../services/config';

const debug = createDebug('sidekick:exec');

type RunOptions = childProcess.ExecOptions & {
    stdin?: string;
    onStdout?: (chunk: string) => void;
    abortController?: AbortController;
};

export class ExecUtils {
    static async runJS<Result, Params = {}>(
        remoteFn: (require: <T>(path: string) => T, params: Params) => Promise<Result>,
        params?: Params,
        options?: RunOptions & { nodeOptions?: string[] }
    ): Promise<Result> {
        const nextConfig = getNextConfig();
        const projectDir = options?.cwd ?? (await ConfigManager.getProjectPath());

        // generate script using function code
        const { path: tmpFilePath } = await tmp.file();
        const { path: outputSocket } = await tmp.file();
        const script = `
            const fs = require('fs')
            const path = require('path')
            const resolve = require('${path.resolve(
                nextConfig.serverRuntimeConfig.PROJECT_ROOT,
                'node_modules',
                'resolve'
            )}').sync
            const root = process.cwd()
            const fakeRequire = p => require(resolve(p, { basedir: 'projectDir' }))
            const entryPoint = ${remoteFn}

            const writeResult = result => fs.writeFileSync('${outputSocket}', JSON.stringify(result))

            entryPoint(fakeRequire, ${JSON.stringify(params ?? {})})
                .then(result => writeResult({ type: 'success', result }))
                .catch(error => {
                    console.error(error)
                    writeResult({ type: 'error', error: String(error.stack || error) })
                })
                .then(() => process.exit())

            setTimeout(function() {
                writeResult({ type: 'error', error: 'Script timed out' })
                process.exit()
            }, 30e3);
            `;
        debug(fmt`Script generated: ${script}`);
        await fs.promises.writeFile(tmpFilePath, script);

        // run script in the right project
        const nodeOptions = options?.nodeOptions ?? [];
        await ExecUtils.runCommand(
            `/Users/karimsa/.nvm/versions/node/v12.22.7/bin/node`,
            [...nodeOptions, tmpFilePath],
            { ...options, cwd: projectDir }
        );
        const resData = await fs.promises.readFile(outputSocket, 'utf8');
        debug(fmt`JS code returned: ${resData.slice(0, 50)}... (${outputSocket})`);

        // act on result
        const { type, result, error } = JSON.parse(resData);
        if (type === 'success') {
            // delete temporary files
            await fs.promises.unlink(tmpFilePath);
            await fs.promises.unlink(outputSocket);

            return result;
        }
        throw new Error(error);
    }

    static async runCommand(cmdPath: string, args: string[], options?: RunOptions): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            let stdout = '';
            let stderr = '';

            debug(
                fmt`Starting process with ${{
                    ...options,
                    cmdPath,
                    args,
                    parentPID: process.pid,

                    // TODO: Fix this
                    // env: '(omitted)'
                    env: {
                        ...process.env,
                        NODE_ENV: 'development',
                        ...(options?.env ?? {})
                    }
                }}`
            );
            const child = childProcess.spawn(cmdPath, args, {
                ...(options ?? {}),
                stdio: 'pipe',
                env: {
                    ...process.env,
                    NODE_ENV: 'development',
                    ...(options?.env ?? {})
                }
            });
            child.on('spawn', () => {
                debug(fmt`${cmdPath} got a pid: ${child.pid}`);
            });
            child.stdout!.on('data', chunk => {
                const chunkStr = chunk.toString('utf8');
                debug(fmt`stdout: ${chunkStr}`);
                stdout += chunkStr;
                options?.onStdout?.(chunkStr);
            });
            child.stderr!.on('data', chunk => {
                stderr += chunk.toString('utf8');
                process.stderr.write(chunk);
            });
            child.on('error', error => {
                reject(error); // i thought i did too
            });
            child.on('exit', code => {
                debug(fmt`Process exited with code ${code}`);
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(stderr));
                }
            });

            if (options?.stdin) {
                child.stdin.write(options.stdin);
                child.stdin.end();
            }

            const abortController = options?.abortController;
            if (abortController) {
                if (abortController?.signal.aborted) {
                    this.treeKill(child.pid!, os.constants.signals.SIGKILL);
                }
                abortController.signal.addEventListener('abort', () => {
                    this.treeKill(child.pid!, os.constants.signals.SIGKILL);
                    reject(new Error(`process aborted`));
                });
            }
        });
    }

    static async isSuspended(pid: number) {
        return String(await this.runCommand('ps', ['-o', 'stat=', '-p', String(pid)])).includes('T');
    }

    static treeKill(pid: number, signal: number) {
        return new Promise<void>((resolve, reject) => {
            treeKill(pid, signal, err => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
}
