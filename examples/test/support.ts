/**
 * What the example tests share: a real Plomba HTTP server (the sandbox,
 * built from the server's createTestApp) with the journey recorded through
 * its API, and a way to run an example's command line as a user would.
 */

import { execFile, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Journey, recordJourney } from '../sandbox/journey.ts';
import { type Sandbox, type SandboxOptions, startSandbox } from '../sandbox/server.ts';
import { PlombaClient } from '../shared/client.ts';

export const EXAMPLES = dirname(dirname(fileURLToPath(import.meta.url)));

export interface Installation {
  readonly sandbox: Sandbox;
  readonly client: PlombaClient;
  /** PLOMBA_URL and PLOMBA_API_TOKEN for a command line. */
  readonly env: Readonly<Record<string, string>>;
}

export async function installation(options: SandboxOptions = {}): Promise<Installation> {
  const sandbox = await startSandbox(options);
  return {
    sandbox,
    client: new PlombaClient({ baseUrl: sandbox.url, token: sandbox.token }),
    env: { PLOMBA_URL: sandbox.url, PLOMBA_API_TOKEN: sandbox.token },
  };
}

/** An installation with the journey of PLBU 400004 3 recorded (see sandbox/journey.ts). */
export async function installationWithJourney(
  options: SandboxOptions = {},
): Promise<Installation & { readonly journey: Journey }> {
  const plomba = await installation(options);
  return { ...plomba, journey: await recordJourney(plomba.client) };
}

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `node examples/<script> …args` to the end, with Node's own type stripping. */
export function runCli(
  script: string,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [join(EXAMPLES, script), ...args],
      { env: { ...process.env, ...env }, timeout: 30_000 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

/**
 * Starts a long-running command line and resolves once a line of its output
 * matches `ready`; `stop()` interrupts it as Ctrl+C would.
 */
export function startCli(
  script: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  ready: RegExp,
): Promise<{ match: RegExpMatchArray; output: () => string; stop: () => Promise<number> }> {
  const child = spawn(process.execPath, [join(EXAMPLES, script), ...args], {
    env: { ...process.env, ...env },
  });
  let output = '';
  const exited = new Promise<number>((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(ready);
      if (match) {
        resolve({
          match,
          output: () => output,
          stop: async () => {
            child.kill('SIGINT');
            return exited;
          },
        });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    exited.then((code) => reject(new Error(`${script} exited with ${code}:\n${output}`)));
  });
}
