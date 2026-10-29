import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Socket } from 'node:net';

export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stderr = '';

        child.stdout.on('data', (chunk) => {
            const text = chunk.toString().trim();
            if (text) {
                options.onOutput?.(text);
            }
        });

        child.stderr.on('data', (chunk) => {
            const text = chunk.toString().trim();
            if (text) {
                stderr += `${text}\n`;
            }
        });

        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(stderr.trim() || `${command} exited with code ${code ?? -1}`));
        });
    });
}

export function runCommandCaptureOutput(command, args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout.trim());
                return;
            }

            reject(new Error(stderr.trim() || `${command} exited with code ${code ?? -1}`));
        });
    });
}

export function runPowerShell(script) {
    return runCommandCaptureOutput('powershell.exe', ['-NoProfile', '-Command', script]);
}

export function escapePowerShell(value) {
    return String(value).replace(/'/g, "''");
}

export async function commandExists(command) {
    try {
        await runCommand(process.platform === 'win32' ? 'where.exe' : 'which', [command]);
        return true;
    }
    catch {
        return false;
    }
}

export function isPortOpen(port, host = '127.0.0.1') {
    return new Promise((resolve) => {
        const socket = new Socket();

        socket.setTimeout(1200);
        socket.once('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.once('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        socket.once('error', () => {
            socket.destroy();
            resolve(false);
        });
        socket.connect(port, host);
    });
}

export async function waitForPort(port, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (await isPortOpen(port)) {
            return;
        }

        await sleep(1000);
    }

    throw new Error(`等待本地端口 ${port} 超时。`);
}

export async function waitForFile(filePath, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (existsSync(filePath)) {
            return;
        }

        await sleep(500);
    }

    throw new Error(`等待文件 ${filePath} 超时。`);
}

export async function readRecentLogLines(filePath, maxLines = 20) {
    try {
        const content = await readFile(filePath, 'utf8');
        return content
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .slice(-maxLines)
            .join(' | ');
    }
    catch {
        return '';
    }
}
