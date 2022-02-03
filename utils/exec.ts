import * as childProcess from 'child_process';
import * as os from 'os';
import createDebug from 'debug';
import treeKill from 'tree-kill';

import { fmt } from './fmt';

const debug = createDebug('sidekick:exec');

type RunOptions = childProcess.ExecOptions & {
    onStdout?: (chunk: string) => void;
    abortController?: AbortController;
};

export class ExecUtils {
    static async runCommand(cmd: string, options?: RunOptions): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            let stdout = '';
            let stderr = '';

            debug(
                fmt`Running: ${cmd} with ${{
                    ...options,
                    env: '(ommitted)'
                }}`
            );
            const child = childProcess.exec(cmd, {
                ...(options ?? {}),
                env: {
                    ...process.env,
                    NODE_ENV: 'development',
                    ...(options?.env ?? {})
                }
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
            child.on('exit', code => {
                debug(fmt`Process exited with code ${code}`);
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(stderr));
                }
            });

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
        return String(await this.runCommand(`ps -o stat= -p ${pid}`)).includes('T');
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
