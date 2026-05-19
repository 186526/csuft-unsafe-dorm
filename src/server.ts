import 'dotenv/config';
import EventEmitter from 'node:events';
import { createReadStream, existsSync, mkdirSync, openSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { createServer, get as httpGet, type IncomingMessage, type ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';
import WebSocket, { type RawData } from 'ws';
import main, { type MainEvents } from './scripts/main.js';
import {
    type ScheduleConfig,
    computeNextRunAt,
    defaultScheduleConfig,
    loadScheduleConfig,
    saveScheduleConfig,
} from './scheduler.js';
import { applyRuntimeSchedule, getRuntimeScheduleStatus } from './runtime-scheduler.js';
import type { AuthTokenResponse, RecordStatus, TaskDetails } from './types.js';

// 本地 Web 服务入口：
// - 提供前端静态页面
// - 提供 OpenID / 定时任务 / 调试器状态接口
// - 通过 SSE 把签到过程实时推送给前端
const PORT = Number(process.env.PORT ?? '3001');
const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, 'web', 'dist');
const WEB_DEV_SERVER_URL = process.env.WEB_DEV_SERVER_URL ?? 'http://127.0.0.1:4173';
const ENV_PATH = path.join(ROOT, '.env');
const TOOL_HOME = path.join(ROOT, '.codex-tools');
const DEBUGGER_DIR = path.join(TOOL_HOME, 'WMPFDebugger');
const DEBUGGER_LOG_PATH = path.join(DEBUGGER_DIR, 'codex-debugger.log');
const DEBUGGER_PID_PATH = path.join(DEBUGGER_DIR, 'codex-debugger.pid');
const DEBUGGER_REPO_URL = process.env.WMPF_DEBUGGER_REPO_URL ?? 'https://github.com/186526/WMPFDebugger';
const DEBUGGER_WS_URL = process.env.WMPF_DEBUGGER_WS_URL ?? 'ws://127.0.0.1:62000';
const DEBUGGER_PREPARE_TIMEOUT_MS = Number(process.env.WMPF_DEBUGGER_PREPARE_TIMEOUT_MS ?? '60000');
const CAPTURE_TIMEOUT_MS = Number(process.env.OPENID_CAPTURE_TIMEOUT_MS ?? '120000');
const MITM_PROXY_PORT = Number(process.env.MITM_OPENID_PROXY_PORT ?? '8866');
const MITM_HOME = path.join(TOOL_HOME, 'mitmproxy');
const MITM_VENV_DIR = path.join(MITM_HOME, 'venv');
const MITM_CAPTURE_FILE = path.join(MITM_HOME, 'openid-capture.jsonl');
const MITM_LOG_PATH = path.join(MITM_HOME, 'mitmdump.log');
const MITM_ADDON_PATH = path.join(ROOT, 'src', 'mitm_openid_addon.py');
const MITM_CERT_PATH = path.join(process.env.USERPROFILE ?? ROOT, '.mitmproxy', 'mitmproxy-ca-cert.cer');
const WMPF_DEBUGGER_PATCH_MARKER = 'codex-wmpf-process-compat';
const ENABLE_WMPF_DEBUGGER_FALLBACK = /^(1|true|yes)$/i.test(process.env.ENABLE_WMPF_DEBUGGER_FALLBACK ?? '');

type WechatRuntimeProcess = {
    name: string;
    pid: number;
    parentPid: number;
    path: string;
};
type Summary = {
    startedAt: string;
    completedAt?: string;
    loginSuccess: boolean;
    withinTimeWindow: boolean | null;
    signStatus: string | null;
    signedSuccess: boolean;
    alreadySigned: boolean;
    account: null | {
        userName: string;
        schoolName: string;
        accountNo: string;
    };
    task: null | {
        taskName: string;
        signStartTime: string;
        signEndTime: string;
    };
    error: string | null;
};

type CaptureSummary = {
    startedAt: string;
    completedAt?: string;
    openid: string | null;
    saved: boolean;
    matchedUrl: string | null;
    error: string | null;
};

type CaptureResult = {
    openid: string;
    matchedUrl: string;
};

type DebuggerStatus = {
    installed: boolean;
    dependenciesInstalled: boolean;
    running: boolean;
    wsUrl: string;
    repoDir: string;
    logPath: string;
};

type ProxySettings = {
    ProxyEnable: number;
    ProxyServer: string;
    ProxyOverride: string;
    AutoConfigURL: string;
};

type PythonRuntime = {
    command: string;
    args: string[];
};

type PipMirror = {
    label: string;
    indexUrl: string;
    trustedHost: string;
};

type ScheduleApiResponse = {
    config: ScheduleConfig;
    runtimeActive: boolean;
    driver: 'node-cron';
    cronPattern: string | null;
    timezone: string;
    lastTriggeredAt: string | null;
};

let runInProgress = false;
let captureInProgress = false;

function parseOpenIds(value: string | undefined): string[] {
    return (value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

// 统一把 OpenID 输入整理成去重后的数组，便于前后端都支持“多账号签到”。
function normalizeOpenIds(input: string | string[] | undefined): string[] {
    if (Array.isArray(input)) {
        return Array.from(new Set(input.map((item) => item.trim()).filter((item) => item.length > 0)));
    }

    return Array.from(new Set(parseOpenIds(input)));
}

function readConfig() {
    const openids = normalizeOpenIds(process.env.openid);
    const openid = openids.join(',');
    return {
        openid,
        openids,
        hasOpenid: openid.length > 0,
        openidCount: openids.length,
        debuggerWsUrl: DEBUGGER_WS_URL,
    };
}

// .env 中依然使用一行 `openid=a,b,c` 保存，兼容旧脚本，同时支持前端多账号配置。
async function saveOpenId(openid: string | string[]) {
    const normalized = normalizeOpenIds(openid).join(',');
    let current = '';
    try {
        current = await readFile(ENV_PATH, 'utf8');
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }

    const lines = current.length > 0 ? current.split(/\r?\n/) : [];
    const nextLines = lines.filter((line) => line.length > 0 && !line.startsWith('openid='));
    nextLines.push(`openid=${normalized}`);

    await writeFile(ENV_PATH, `${nextLines.join('\n')}\n`, 'utf8');
    process.env.openid = normalized;
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
    const chunks: Buffer[] = [];

    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

function serializeError(error: unknown) {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function formatLogPart(value: unknown): string {
    if (value instanceof Error) {
        return value.message;
    }

    if (typeof value === 'string') {
        return value;
    }

    return JSON.stringify(value);
}

function sendEvent(res: ServerResponse, event: string, payload: unknown) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function maybeServeStatic(res: ServerResponse, pathname: string) {
    const targetPath = pathname === '/'
        ? path.join(DIST_DIR, 'index.html')
        : path.join(DIST_DIR, pathname);
    const resolvedPath = path.resolve(targetPath);

    if (!resolvedPath.startsWith(path.resolve(DIST_DIR))) {
        sendJson(res, 403, { error: 'Forbidden' });
        return true;
    }

    try {
        const fileStats = await stat(resolvedPath);
        if (!fileStats.isFile()) {
            return false;
        }

        const ext = path.extname(resolvedPath);
        const contentType = ext === '.js'
            ? 'text/javascript; charset=utf-8'
            : ext === '.css'
                ? 'text/css; charset=utf-8'
                : ext === '.html'
                    ? 'text/html; charset=utf-8'
                    : 'application/octet-stream';

        res.statusCode = 200;
        res.setHeader('Content-Type', contentType);
        createReadStream(resolvedPath).pipe(res);
        return true;
    }
    catch {
        if (pathname !== '/' && !path.extname(pathname)) {
            return maybeServeStatic(res, '/');
        }

        return false;
    }
}

function shouldProxyToWebDevServer(pathname: string) {
    return pathname === '/'
        || pathname.startsWith('/assets/')
        || pathname.startsWith('/src/')
        || pathname.startsWith('/node_modules/')
        || pathname.startsWith('/@vite')
        || pathname.startsWith('/@react-refresh')
        || pathname === '/favicon.ico'
        || pathname.endsWith('.js')
        || pathname.endsWith('.css')
        || pathname.endsWith('.map');
}

async function maybeProxyWebDevServer(req: IncomingMessage, res: ServerResponse, pathname: string, search: string) {
    if (req.method !== 'GET' || !shouldProxyToWebDevServer(pathname)) {
        return false;
    }

    const devServerUrl = new URL(WEB_DEV_SERVER_URL);
    const devServerReachable = await isPortOpen(Number(devServerUrl.port), devServerUrl.hostname);
    if (!devServerReachable) {
        return false;
    }

    return await new Promise<boolean>((resolve) => {
        const proxyRequest = httpGet(
            new URL(`${pathname}${search}`, WEB_DEV_SERVER_URL),
            (proxyResponse) => {
                res.statusCode = proxyResponse.statusCode ?? 502;

                for (const [headerName, headerValue] of Object.entries(proxyResponse.headers)) {
                    if (headerValue !== undefined) {
                        res.setHeader(headerName, headerValue);
                    }
                }

                proxyResponse.pipe(res);
                proxyResponse.once('end', () => resolve(true));
                proxyResponse.once('error', () => resolve(false));
            },
        );

        proxyRequest.once('error', () => resolve(false));
    });
}

function createCaptureError(message: string) {
    return new Error(message);
}

function isPortOpen(port: number, host = '127.0.0.1') {
    return new Promise<boolean>((resolve) => {
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

function getDebuggerPort() {
    return Number(new URL(DEBUGGER_WS_URL).port || '80');
}

async function getDebuggerStatus(): Promise<DebuggerStatus> {
    return {
        installed: existsSync(path.join(DEBUGGER_DIR, '.git')),
        dependenciesInstalled: existsSync(path.join(DEBUGGER_DIR, 'node_modules')),
        running: await isPortOpen(getDebuggerPort()),
        wsUrl: DEBUGGER_WS_URL,
        repoDir: DEBUGGER_DIR,
        logPath: DEBUGGER_LOG_PATH,
    };
}

function normalizeJsonArray<T>(value: unknown): T[] {
    if (Array.isArray(value)) {
        return value as T[];
    }

    if (value == null) {
        return [];
    }

    return [value as T];
}

async function listWechatRuntimeProcesses(): Promise<WechatRuntimeProcess[]> {
    const output = await runPowerShell(`
        $items = @(
            Get-CimInstance Win32_Process | Where-Object {
                $_.Name -match '^(WeChatAppEx|WeChatAppHost|WeChat|Weixin)\\.exe$' -or
                ($_.ExecutablePath -and $_.ExecutablePath -match 'WMPF')
            } | Select-Object @{
                Name = 'name'; Expression = { $_.Name }
            }, @{
                Name = 'pid'; Expression = { [int]$_.ProcessId }
            }, @{
                Name = 'parentPid'; Expression = { [int]$_.ParentProcessId }
            }, @{
                Name = 'path'; Expression = { [string]$_.ExecutablePath }
            }
        )
        $items | ConvertTo-Json -Compress
    `);

    if (!output) {
        return [];
    }

    return normalizeJsonArray<WechatRuntimeProcess>(JSON.parse(output)).map((process) => ({
        name: String(process.name ?? ''),
        pid: Number(process.pid ?? 0),
        parentPid: Number(process.parentPid ?? 0),
        path: String(process.path ?? ''),
    }));
}

function selectWechatMiniProgramRuntime(processes: WechatRuntimeProcess[]): WechatRuntimeProcess | null {
    const runtimeProcesses = processes.filter((process) =>
        process.name === 'WeChatAppEx.exe'
        || process.name === 'WeChatAppHost.exe'
        || /(?:^|\\)(?:WeChatAppEx|WeChatAppHost)\.exe$/i.test(process.path)
        || /(?:^|\\)(?:Radium)?WMPF/i.test(process.path),
    );

    if (runtimeProcesses.length === 0) {
        return null;
    }

    const parentPidCounts = new Map<number, number>();
    for (const process of runtimeProcesses) {
        if (process.parentPid > 0) {
            parentPidCounts.set(process.parentPid, (parentPidCounts.get(process.parentPid) ?? 0) + 1);
        }
    }

    const parentPid = Array.from(parentPidCounts.entries())
        .sort((left, right) => right[1] - left[1])
        .at(0)?.[0];

    if (parentPid != null) {
        return processes.find((process) => process.pid === parentPid) ?? runtimeProcesses[0];
    }

    return runtimeProcesses[0];
}

function extractWmpfVersion(processPath: string): number | null {
    const matches = processPath.match(/\d+/g);
    if (!matches || matches.length === 0) {
        return null;
    }

    const version = Number(matches[matches.length - 1]);
    if (!Number.isFinite(version) || version <= 0) {
        return null;
    }

    return version;
}

async function waitForWechatMiniProgramRuntime(onStatus: (message: string, stage: string) => void) {
    onStatus(
        'WMPFDebugger needs the target WeChat mini program process. Open WeChat PC, enter the target mini program, and keep that page open.',
        'prepare',
    );

    const startedAt = Date.now();
    while (Date.now() - startedAt < DEBUGGER_PREPARE_TIMEOUT_MS) {
        const processes = await listWechatRuntimeProcesses();
        const runtimeProcess = selectWechatMiniProgramRuntime(processes);
        if (runtimeProcess) {
            onStatus(
                `Detected mini program runtime process ${runtimeProcess.name} (pid ${runtimeProcess.pid}).`,
                'prepare',
            );
            return runtimeProcess;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error(
        'No WeChat mini program runtime process was found. Open WeChat PC, enter the target mini program, keep it open, and then start capture again.',
    );
}

async function ensureWmpfVersionSupported(processPath: string, onStatus: (message: string, stage: string) => void) {
    const version = extractWmpfVersion(processPath);
    if (version == null) {
        onStatus('Could not infer the current WMPF version from the process path. Continuing anyway.', 'version');
        return;
    }

    const addressesPath = path.join(DEBUGGER_DIR, 'frida', 'config', `addresses.${version}.json`);
    if (!existsSync(addressesPath)) {
        throw new Error(
            `Detected WMPF version ${version}, but the bundled WMPFDebugger has no addresses.${version}.json. Install mitmproxy or update WMPFDebugger before using debugger fallback.`,
        );
    }

    onStatus(`Detected WMPF version ${version}.`, 'version');
}

async function patchBundledWmpfDebugger(onStatus: (message: string, stage: string) => void) {
    const debuggerEntryPath = path.join(DEBUGGER_DIR, 'src', 'index.ts');
    if (!existsSync(debuggerEntryPath)) {
        return;
    }

    const source = await readFile(debuggerEntryPath, 'utf8');
    if (source.includes(WMPF_DEBUGGER_PATCH_MARKER)) {
        return;
    }

    const processDetectionPattern =
        /const wmpfProcesses = processes\.filter\([\s\S]*?if \(wmpfPid === undefined\) \{\s*throw new Error\("\[frida\] WeChatAppEx\.exe process not found"\);\s*return;\s*}/;

    const patchedSource = source.replace(
        processDetectionPattern,
        `// ${WMPF_DEBUGGER_PATCH_MARKER}
    const targetProcessNames = ["WeChatAppEx.exe", "WeChatAppHost.exe"];
    const wmpfProcesses = processes.filter(process => {
        const processPath = String(process.parameters.path ?? "");
        return targetProcessNames.includes(process.name)
            || /(?:^|\\\\)(?:WeChatAppEx|WeChatAppHost)\\.exe$/i.test(processPath)
            || /(?:^|\\\\)(?:Radium)?WMPF/i.test(processPath);
    });
    const wmpfPids = wmpfProcesses
        .map(process => process.parameters.ppid ? Number(process.parameters.ppid) : 0)
        .filter(pid => pid > 0);

    // find the parent process
    const fallbackPid = wmpfProcesses.find(process => process.pid > 0)?.pid;
    const wmpfPid = wmpfPids
        .sort((a, b) => wmpfPids.filter(v => v === a).length - wmpfPids.filter(v => v === b).length)
        .pop() ?? fallbackPid;
    if (wmpfPid === undefined) {
        const relatedProcesses = processes
            .filter(process => {
                const processPath = String(process.parameters.path ?? "");
                return /wechat|weixin/i.test(process.name) || /wmpf/i.test(processPath);
            })
            .map(process => \`\${process.name}#\${process.pid}\`)
            .join(", ");
        throw new Error(\`[frida] WMPF runtime process not found. Open the WeChat mini program before starting the debugger. Related processes: \${relatedProcesses || "none"}\`);
    }`,
    );

    if (patchedSource === source) {
        onStatus('WMPFDebugger source layout changed, skipping the local process-name compatibility patch.', 'patch');
        return;
    }

    await writeFile(debuggerEntryPath, patchedSource, 'utf8');
    onStatus('Applied the local WMPFDebugger process-name compatibility patch.', 'patch');
}

function getCommandName(base: 'npm' | 'git') {
    return process.platform === 'win32' ? `${base}.cmd` : base;
}

async function runCommand(
    command: string,
    args: string[],
    cwd: string,
    onStatus?: (message: string, stage: string) => void,
) {
    return await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stderr = '';

        child.stdout.on('data', (chunk: Buffer) => {
            const text = chunk.toString().trim();
            if (text && onStatus) {
                onStatus(text, 'detail');
            }
        });

        child.stderr.on('data', (chunk: Buffer) => {
            const text = chunk.toString().trim();
            if (text) {
                stderr += `${text}\n`;
            }
        });

        child.on('error', (error) => {
            reject(error);
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(stderr.trim() || `${command} exited with code ${code ?? -1}`));
        });
    });
}

async function runCommandCaptureOutput(
    command: string,
    args: string[],
    cwd: string,
) {
    return await new Promise<string>((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });

        child.on('error', (error) => {
            reject(error);
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout.trim());
                return;
            }

            reject(new Error(stderr.trim() || `${command} exited with code ${code ?? -1}`));
        });
    });
}

async function waitForPort(port: number, timeoutMs: number) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (await isPortOpen(port)) {
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error(`Timed out waiting for local debugger port ${port}.`);
}

async function waitForFile(filePath: string, timeoutMs: number) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (existsSync(filePath)) {
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(`Timed out waiting for file ${filePath}.`);
}

async function readRecentLogLines(filePath: string, maxLines = 20) {
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

function runPowerShell(script: string) {
    return new Promise<string>((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-Command', script], {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });

        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout.trim());
                return;
            }

            reject(new Error(stderr.trim() || `PowerShell exited with code ${code ?? -1}`));
        });
    });
}

async function commandExists(command: string) {
    try {
        await runCommand(process.platform === 'win32' ? 'where.exe' : 'which', [command], ROOT);
        return true;
    }
    catch {
        return false;
    }
}

function getMitmExecutableName(base: 'python' | 'mitmdump') {
    if (process.platform !== 'win32') {
        return base;
    }

    return base === 'python' ? 'python.exe' : 'mitmdump.exe';
}

function getMitmVenvBinDir() {
    if (process.platform === 'win32') {
        const scriptsDir = path.join(MITM_VENV_DIR, 'Scripts');
        if (existsSync(scriptsDir)) {
            return scriptsDir;
        }

        const binDir = path.join(MITM_VENV_DIR, 'bin');
        if (existsSync(binDir)) {
            return binDir;
        }

        return scriptsDir;
    }

    return path.join(MITM_VENV_DIR, 'bin');
}

function getMitmVenvPythonPath() {
    return path.join(getMitmVenvBinDir(), getMitmExecutableName('python'));
}

function getMitmVenvMitmdumpPath() {
    return path.join(getMitmVenvBinDir(), getMitmExecutableName('mitmdump'));
}

async function canUsePythonRuntime(runtime: PythonRuntime) {
    try {
        const output = await runCommandCaptureOutput(
            runtime.command,
            [
                ...runtime.args,
                '-c',
                'import os, sys; print(sys.executable); print(sys.version)',
            ],
            ROOT,
        );
        const lines = output
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        const executable = lines[0]?.toLowerCase() ?? '';
        const version = lines[1] ?? '';

        if (process.platform === 'win32') {
            if (executable.includes('\\windowsapps\\')) {
                return false;
            }

            if (executable.includes('\\msys64\\') || /\[gcc\b/i.test(version)) {
                return false;
            }
        }

        return true;
    }
    catch {
        return false;
    }
}

async function getPythonRuntimeExecutable(runtime: PythonRuntime) {
    const output = await runCommandCaptureOutput(
        runtime.command,
        [
            ...runtime.args,
            '-c',
            'import sys; print(sys.executable)',
        ],
        ROOT,
    );
    return output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? '';
}

async function getPythonRuntime(): Promise<PythonRuntime | null> {
    const candidates: PythonRuntime[] = [];

    const configuredPython = process.env.MITM_PYTHON_PATH?.trim();
    if (configuredPython) {
        candidates.push({
            command: configuredPython,
            args: [],
        });
    }

    const bundledPython = path.join(
        process.env.USERPROFILE ?? '',
        '.cache',
        'codex-runtimes',
        'codex-primary-runtime',
        'dependencies',
        'python',
        'python.exe',
    );
    if (process.platform === 'win32' && bundledPython.length > 0 && existsSync(bundledPython)) {
        candidates.push({
            command: bundledPython,
            args: [],
        });
    }

    if (await commandExists('py')) {
        candidates.push({
            command: 'py',
            args: ['-3'],
        });
    }

    if (await commandExists('python')) {
        candidates.push({
            command: 'python',
            args: [],
        });
    }

    if (await commandExists('python3')) {
        candidates.push({
            command: 'python3',
            args: [],
        });
    }

    for (const candidate of candidates) {
        if (await canUsePythonRuntime(candidate)) {
            return candidate;
        }
    }

    return null;
}

async function resolveMitmdumpExecutable(pythonRuntime?: PythonRuntime | null) {
    const localMitmdump = getMitmVenvMitmdumpPath();
    if (existsSync(localMitmdump)) {
        return localMitmdump;
    }

    try {
        const output = await runCommandCaptureOutput(
            process.platform === 'win32' ? 'where.exe' : 'which',
            ['mitmdump'],
            ROOT,
        );
        const candidate = output
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line.length > 0);
        if (candidate) {
            return candidate;
        }
    }
    catch {
        // ignore where/which failure and continue probing
    }

    if (!pythonRuntime) {
        return null;
    }

    const scriptName = process.platform === 'win32' ? 'mitmdump.exe' : 'mitmdump';
    try {
        const output = await runCommandCaptureOutput(
            pythonRuntime.command,
            [
                ...pythonRuntime.args,
                '-c',
                `import os, sysconfig; print(os.path.join(sysconfig.get_path("scripts"), "${scriptName}"))`,
            ],
            ROOT,
        );
        const candidate = output.trim();
        if (candidate.length > 0 && existsSync(candidate)) {
            return candidate;
        }
    }
    catch {
        // ignore python path probing failure
    }

    return null;
}

async function ensureMitmVirtualEnv(pythonRuntime: PythonRuntime, onStatus: (message: string, stage: string) => void) {
    mkdirSync(MITM_HOME, { recursive: true });

    const venvPython = getMitmVenvPythonPath();
    const venvConfigPath = path.join(MITM_VENV_DIR, 'pyvenv.cfg');
    let shouldRecreateVenv = !existsSync(venvPython) || !existsSync(venvConfigPath);

    if (!shouldRecreateVenv && existsSync(venvConfigPath)) {
        try {
            const [venvConfig, runtimeExecutable] = await Promise.all([
                readFile(venvConfigPath, 'utf8'),
                getPythonRuntimeExecutable(pythonRuntime),
            ]);
            const normalizedRuntimeExecutable = runtimeExecutable.trim().toLowerCase();
            const configExecutableLine = venvConfig
                .split(/\r?\n/)
                .map((line) => line.trim())
                .find((line) => line.toLowerCase().startsWith('executable = '));
            const configExecutable = configExecutableLine
                ? configExecutableLine.slice('executable = '.length).trim().toLowerCase()
                : '';

            if (
                (configExecutable && normalizedRuntimeExecutable && configExecutable !== normalizedRuntimeExecutable) ||
                configExecutable.includes('\\msys64\\')
            ) {
                shouldRecreateVenv = true;
                onStatus('检测到已有 mitmproxy 虚拟环境来自其它 Python，正在重建。', 'install');
            }
        }
        catch {
            shouldRecreateVenv = true;
        }
    }

    if (shouldRecreateVenv) {
        onStatus('Creating a project-local Python virtual environment for mitmproxy.', 'install');
        await runCommand(
            pythonRuntime.command,
            [
                ...pythonRuntime.args,
                '-m',
                'venv',
                ...(existsSync(MITM_VENV_DIR) ? ['--clear'] : []),
                MITM_VENV_DIR,
            ],
            ROOT,
            onStatus,
        );
    }

    try {
        await runCommand(
            venvPython,
            ['-m', 'pip', '--version'],
            ROOT,
        );
    }
    catch {
        onStatus('pip is unavailable inside the project mitmproxy environment, bootstrapping it now.', 'install');
        await runCommand(
            venvPython,
            ['-m', 'ensurepip', '--upgrade'],
            ROOT,
            onStatus,
        );
    }

    return venvPython;
}

function getPipMirrorCandidates(): PipMirror[] {
    const customIndexUrl = process.env.PIP_INDEX_URL?.trim();
    const customTrustedHost = process.env.PIP_TRUSTED_HOST?.trim();
    const mirrors: PipMirror[] = [];

    if (customIndexUrl) {
        let trustedHost = customTrustedHost ?? '';
        if (!trustedHost) {
            try {
                trustedHost = new URL(customIndexUrl).host;
            }
            catch {
                trustedHost = '';
            }
        }

        mirrors.push({
            label: 'custom pip mirror',
            indexUrl: customIndexUrl,
            trustedHost,
        });
    }

    mirrors.push(
        {
            label: 'official PyPI',
            indexUrl: 'https://pypi.org/simple',
            trustedHost: 'pypi.org',
        },
        {
            label: 'Tsinghua Tuna mirror',
            indexUrl: 'https://pypi.tuna.tsinghua.edu.cn/simple',
            trustedHost: 'pypi.tuna.tsinghua.edu.cn',
        },
        {
            label: 'Aliyun mirror',
            indexUrl: 'https://mirrors.aliyun.com/pypi/simple',
            trustedHost: 'mirrors.aliyun.com',
        },
    );

    return mirrors;
}

async function installMitmproxyPackage(venvPython: string, onStatus: (message: string, stage: string) => void) {
    const baseArgs = [
        '-m',
        'pip',
        'install',
        '--disable-pip-version-check',
        '--prefer-binary',
        '--only-binary=:all:',
        'mitmproxy',
    ];

    try {
        await runCommand(venvPython, baseArgs, ROOT, onStatus);
        return;
    }
    catch (error) {
        const message = serializeError(error);
        const looksLikeCertificateError =
            /CERTIFICATE_VERIFY_FAILED|SSLCertVerificationError|unable to get local issuer certificate/i.test(message);

        if (!looksLikeCertificateError) {
            throw error;
        }

        onStatus('pip 访问默认源时遇到证书校验问题，正在尝试镜像源。', 'install');

        const mirrors = getPipMirrorCandidates();
        let lastError: unknown = error;

        for (const mirror of mirrors) {
            try {
                onStatus(`尝试通过 ${mirror.label} 安装 mitmproxy。`, 'install');
                const args = [...baseArgs, '-i', mirror.indexUrl];
                if (mirror.trustedHost) {
                    args.push('--trusted-host', mirror.trustedHost);
                    if (mirror.trustedHost === 'pypi.org') {
                        args.push('--trusted-host', 'files.pythonhosted.org');
                    }
                }

                await runCommand(venvPython, args, ROOT, onStatus);
                return;
            }
            catch (mirrorError) {
                lastError = mirrorError;
            }
        }

        throw new Error(
            `pip 默认源证书校验失败，镜像源重试也没有成功：${serializeError(lastError)}`,
        );
    }
}

async function ensureMitmdumpReady(onStatus: (message: string, stage: string) => void) {
    const pythonRuntime = await getPythonRuntime();
    const existingExecutable = await resolveMitmdumpExecutable(pythonRuntime);
    if (existingExecutable) {
        return existingExecutable;
    }

    if (!pythonRuntime) {
        throw new Error(
            'mitmdump 缺失，而且当前没有找到适合安装 mitmproxy 的 Python。请安装标准 Windows CPython，或通过 MITM_PYTHON_PATH 指定一个可用的 python.exe。',
        );
    }

    onStatus('mitmproxy is not installed. Creating a project-local environment and installing it now.', 'install');

    const venvPython = await ensureMitmVirtualEnv(pythonRuntime, onStatus);

    await installMitmproxyPackage(venvPython, onStatus);

    const installedExecutable = await resolveMitmdumpExecutable();
    if (!installedExecutable) {
        throw new Error(
            'mitmproxy installation finished, but the project-local mitmdump executable could not be located. Check the virtual environment under .codex-tools/mitmproxy/venv and try again.',
        );
    }

    onStatus('mitmproxy is installed into the project-local environment and ready.', 'install');
    return installedExecutable;
}

async function buildScheduleResponse(config: ScheduleConfig): Promise<ScheduleApiResponse> {
    const runtime = getRuntimeScheduleStatus();
    return {
        config: {
            ...defaultScheduleConfig(),
            ...config,
            nextRunAt: computeNextRunAt(config),
        },
        runtimeActive: runtime.active,
        driver: runtime.driver,
        cronPattern: runtime.pattern,
        timezone: runtime.timezone,
        lastTriggeredAt: runtime.lastTriggeredAt,
    };
}

async function readProxySettings(): Promise<ProxySettings> {
    const output = await runPowerShell(`
        $path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
        $item = Get-ItemProperty $path
        [pscustomobject]@{
            ProxyEnable = [int]($item.ProxyEnable)
            ProxyServer = [string]($item.ProxyServer)
            ProxyOverride = [string]($item.ProxyOverride)
            AutoConfigURL = [string]($item.AutoConfigURL)
        } | ConvertTo-Json -Compress
    `);
    return JSON.parse(output) as ProxySettings;
}

function escapePowerShell(value: string) {
    return value.replace(/'/g, "''");
}

async function applyProxySettings(settings: ProxySettings) {
    const script = `
        $path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
        Set-ItemProperty $path ProxyEnable ${settings.ProxyEnable}
        Set-ItemProperty $path ProxyServer '${escapePowerShell(settings.ProxyServer ?? '')}'
        Set-ItemProperty $path ProxyOverride '${escapePowerShell(settings.ProxyOverride ?? '')}'
        if ('${escapePowerShell(settings.AutoConfigURL ?? '')}' -ne '') {
            Set-ItemProperty $path AutoConfigURL '${escapePowerShell(settings.AutoConfigURL)}'
        } elseif ((Get-ItemProperty $path).PSObject.Properties.Name -contains 'AutoConfigURL') {
            Remove-ItemProperty $path AutoConfigURL -ErrorAction SilentlyContinue
        }
        Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeWinInet {
    [DllImport("wininet.dll", SetLastError=true)]
    public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
}
"@
        [NativeWinInet]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null
        [NativeWinInet]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null
    `;
    await runPowerShell(script);
}

function mergeProxyOverride(current: string, extra: string[]) {
    const values = new Set(
        current
            .split(';')
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
    );

    for (const item of extra) {
        values.add(item);
    }

    return Array.from(values).join(';');
}

async function ensureMitmCertificate(onStatus: (message: string, stage: string) => void) {
    if (!existsSync(MITM_CERT_PATH)) {
        throw new Error(`mitmproxy certificate was not found at ${MITM_CERT_PATH}.`);
    }

    const exactCertificateTrusted = await runPowerShell(`
        $certPath = '${escapePowerShell(MITM_CERT_PATH)}'
        $thumbprint = (Get-PfxCertificate $certPath).Thumbprint
        $existing = Get-ChildItem Cert:\\CurrentUser\\Root | Where-Object { $_.Thumbprint -eq $thumbprint } | Select-Object -First 1
        if ($null -ne $existing) {
            Write-Output 'trusted'
        }
    `);
    if (exactCertificateTrusted.includes('trusted')) {
        onStatus('mitmproxy root certificate is already trusted.', 'certificate');
        return;
    }

    onStatus('Installing the mitmproxy root certificate into the current user trust store.', 'certificate');
    await runCommand('certutil.exe', ['-user', '-addstore', 'Root', MITM_CERT_PATH], ROOT);
}

async function waitForOpenIdInCaptureFile(filePath: string, timeoutMs: number) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        if (existsSync(filePath)) {
            const raw = await readFile(filePath, 'utf8');
            const lines = raw
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line.length > 0);

            for (const line of lines.reverse()) {
                const record = JSON.parse(line) as { openid?: string; matched_url?: string };
                if (record.openid) {
                    return {
                        openid: record.openid,
                        matchedUrl: record.matched_url ?? '',
                    };
                }
            }
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error('Timed out waiting for mitmproxy to capture the OpenID response.');
}

async function captureOpenIdViaMitmproxy(
    onStatus: (message: string, stage: string) => void,
    mitmdumpExecutable: string,
): Promise<CaptureResult> {
    mkdirSync(MITM_HOME, { recursive: true });
    await writeFile(MITM_CAPTURE_FILE, '', 'utf8');

    const stdoutFd = openSync(MITM_LOG_PATH, 'a');
    const stderrFd = openSync(MITM_LOG_PATH, 'a');
    const originalProxy = await readProxySettings();

    const proxySettings: ProxySettings = {
        ...originalProxy,
        ProxyEnable: 1,
        ProxyServer: `127.0.0.1:${MITM_PROXY_PORT}`,
        ProxyOverride: mergeProxyOverride(originalProxy.ProxyOverride ?? '', ['localhost', '127.0.0.1', '<local>']),
    };

    const child = spawn(mitmdumpExecutable, [
        '-q',
        '-s',
        MITM_ADDON_PATH,
        '--listen-host',
        '127.0.0.1',
        '--listen-port',
        String(MITM_PROXY_PORT),
    ], {
        env: {
            ...process.env,
            MITM_OPENID_CAPTURE_FILE: MITM_CAPTURE_FILE,
        },
        windowsHide: true,
        stdio: ['ignore', stdoutFd, stderrFd],
    });

    try {
        onStatus('Starting local proxy capture with mitmproxy.', 'launch');
        await waitForPort(MITM_PROXY_PORT, 10000);
        await waitForFile(MITM_CERT_PATH, 10000);
        await ensureMitmCertificate(onStatus);
        await applyProxySettings(proxySettings);
        onStatus('Proxy capture is ready. Open the WeChat mini program and tap login once.', 'ready');
        return await waitForOpenIdInCaptureFile(MITM_CAPTURE_FILE, CAPTURE_TIMEOUT_MS);
    }
    finally {
        try {
            child.kill();
        }
        catch {
            // ignore child shutdown errors
        }

        await applyProxySettings(originalProxy);
    }
}

async function ensureDebuggerReady(onStatus: (message: string, stage: string) => void) {
    const currentStatus = await getDebuggerStatus();
    if (currentStatus.running) {
        onStatus('WMPFDebugger is already running.', 'ready');
        return currentStatus;
    }

    mkdirSync(TOOL_HOME, { recursive: true });

    if (!currentStatus.installed) {
        onStatus('Downloading WMPFDebugger from GitHub. This only happens on first run.', 'clone');
        await runCommand(
            getCommandName('git'),
            ['clone', '--depth', '1', DEBUGGER_REPO_URL, DEBUGGER_DIR],
            TOOL_HOME,
        );
    }
    else {
        onStatus('WMPFDebugger repository already exists locally.', 'clone');
    }

    if (!existsSync(path.join(DEBUGGER_DIR, 'node_modules'))) {
        onStatus('Installing WMPFDebugger dependencies. First run may take a while.', 'install');
        await runCommand(getCommandName('npm'), ['install'], DEBUGGER_DIR);
    }
    else {
        onStatus('WMPFDebugger dependencies are already installed.', 'install');
    }

    await patchBundledWmpfDebugger(onStatus);

    if (await isPortOpen(getDebuggerPort())) {
        onStatus('Debugger websocket is already listening.', 'ready');
        return await getDebuggerStatus();
    }

    const runtimeProcess = await waitForWechatMiniProgramRuntime(onStatus);
    await ensureWmpfVersionSupported(runtimeProcess.path, onStatus);

    onStatus('Starting WMPFDebugger in the background.', 'launch');

    const tsNodeBin = path.join(DEBUGGER_DIR, 'node_modules', 'ts-node', 'dist', 'bin.js');
    if (!existsSync(tsNodeBin)) {
        throw new Error('ts-node was not installed under WMPFDebugger. Try running the setup again.');
    }

    mkdirSync(DEBUGGER_DIR, { recursive: true });
    const stdoutFd = openSync(DEBUGGER_LOG_PATH, 'a');
    const stderrFd = openSync(DEBUGGER_LOG_PATH, 'a');
    const child = spawn(process.execPath, [tsNodeBin, 'src/index.ts'], {
        cwd: DEBUGGER_DIR,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', stdoutFd, stderrFd],
    });
    child.unref();
    await writeFile(DEBUGGER_PID_PATH, String(child.pid), 'utf8');

    try {
        await waitForPort(getDebuggerPort(), 45000);
    }
    catch (error) {
        const recentLog = await readRecentLogLines(DEBUGGER_LOG_PATH);
        throw new Error(
            recentLog.length > 0
                ? `WMPFDebugger failed to start. Recent log: ${recentLog}`
                : serializeError(error),
        );
    }
    onStatus('WMPFDebugger is ready. Go to WeChat and tap login once.', 'ready');

    return await getDebuggerStatus();
}

async function captureOpenIdFromDebugger(
    onStatus: (message: string, stage: string) => void,
): Promise<CaptureResult> {
    return await new Promise<CaptureResult>((resolve, reject) => {
        const ws = new WebSocket(DEBUGGER_WS_URL);
        const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
        const timeout = setTimeout(() => {
            fail(createCaptureError('Timed out waiting for the mini program login request. Try tapping login once inside WeChat.'));
        }, CAPTURE_TIMEOUT_MS);

        let nextId = 1;
        let settled = false;
        let matchedRequestId: string | null = null;

        function finish(result: CaptureResult) {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timeout);
            ws.close();
            resolve(result);
        }

        function fail(error: Error) {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timeout);
            for (const item of pending.values()) {
                item.reject(error);
            }
            pending.clear();
            try {
                ws.close();
            }
            catch {
                // ignore close errors
            }
            reject(error);
        }

        function sendCommand(method: string, params: Record<string, unknown> = {}) {
            const id = nextId++;
            ws.send(JSON.stringify({ id, method, params }));
            return new Promise<unknown>((commandResolve, commandReject) => {
                pending.set(id, { resolve: commandResolve, reject: commandReject });
            });
        }

        ws.on('open', async () => {
            try {
                onStatus('Connected to WMPFDebugger, enabling network inspection.', 'connected');
                await sendCommand('Network.enable');
                onStatus('Network inspection is ready. Tap login once in WeChat.', 'ready');
            }
            catch (error) {
                fail(error instanceof Error ? error : createCaptureError('Failed to initialize the network listener.'));
            }
        });

        ws.on('message', async (raw: RawData) => {
            try {
                const message = JSON.parse(raw.toString()) as {
                    id?: number;
                    method?: string;
                    params?: Record<string, unknown>;
                    result?: Record<string, unknown>;
                    error?: { message?: string };
                };

                if (typeof message.id === 'number') {
                    const item = pending.get(message.id);
                    if (!item) {
                        return;
                    }

                    pending.delete(message.id);
                    if (message.error?.message) {
                        item.reject(createCaptureError(message.error.message));
                        return;
                    }

                    item.resolve(message.result);
                    return;
                }

                if (message.method !== 'Network.responseReceived') {
                    return;
                }

                const responseUrl = String((message.params?.response as { url?: string } | undefined)?.url ?? '');
                if (!responseUrl.includes('getOpenidByJsCode')) {
                    return;
                }

                const requestId = String(message.params?.requestId ?? '');
                if (!requestId || matchedRequestId === requestId) {
                    return;
                }

                matchedRequestId = requestId;
                onStatus('Detected getOpenidByJsCode. Extracting OpenID now.', 'matched');

                const responseBody = await sendCommand('Network.getResponseBody', { requestId }) as {
                    body?: string;
                    base64Encoded?: boolean;
                };
                const bodyText = responseBody.base64Encoded
                    ? Buffer.from(String(responseBody.body ?? ''), 'base64').toString('utf8')
                    : String(responseBody.body ?? '');
                const parsed = JSON.parse(bodyText);
                const openid = typeof parsed?.data === 'string' ? parsed.data.trim() : '';

                if (!openid) {
                    throw createCaptureError('Matched the target request, but the response did not contain an OpenID.');
                }

                finish({
                    openid,
                    matchedUrl: responseUrl,
                });
            }
            catch (error) {
                fail(error instanceof Error ? error : createCaptureError('Failed while parsing the debugger response.'));
            }
        });

        ws.on('error', (error: Error) => {
            fail(createCaptureError(`Could not connect to ${DEBUGGER_WS_URL}. ${error.message}`));
        });

        ws.on('close', () => {
            if (!settled) {
                fail(createCaptureError('Debugger connection closed before the OpenID request was captured.'));
            }
        });
    });
}

async function handleCaptureStream(res: ServerResponse) {
    if (captureInProgress) {
        res.statusCode = 409;
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        sendEvent(res, 'summary', {
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            openid: null,
            saved: false,
            matchedUrl: null,
            error: 'Another OpenID capture task is already running.',
        } satisfies CaptureSummary);
        res.end();
        return;
    }

    captureInProgress = true;
    const summary: CaptureSummary = {
        startedAt: new Date().toISOString(),
        openid: null,
        saved: false,
        matchedUrl: null,
        error: null,
    };

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    const sendStatus = (message: string, stage: string) => {
        sendEvent(res, 'status', {
            stage,
            message,
            at: new Date().toISOString(),
        });
    };

    try {
        sendStatus('Preparing the local capture environment.', 'prepare');
        let result: CaptureResult;
        try {
            const mitmdumpExecutable = await ensureMitmdumpReady(sendStatus);
            sendStatus('Using mitmproxy for automatic OpenID capture.', 'prepare');
            result = await captureOpenIdViaMitmproxy(sendStatus, mitmdumpExecutable);
        }
        catch (error) {
            if (!ENABLE_WMPF_DEBUGGER_FALLBACK) {
                throw error;
            }

            sendStatus(
                `mitmproxy could not be prepared (${serializeError(error)}). Debugger fallback is explicitly enabled, switching to WMPFDebugger.`,
                'prepare',
            );
            await ensureDebuggerReady(sendStatus);
            result = await captureOpenIdFromDebugger(sendStatus);
        }
        summary.openid = result.openid;
        summary.matchedUrl = result.matchedUrl;
        await saveOpenId([...normalizeOpenIds(process.env.openid), result.openid]);
        summary.saved = true;
        sendEvent(res, 'found', {
            openid: result.openid,
            matchedUrl: result.matchedUrl,
        });
    }
    catch (error) {
        summary.error = serializeError(error);
        sendEvent(res, 'error', {
            message: summary.error,
        });
    }
    finally {
        summary.completedAt = new Date().toISOString();
        sendEvent(res, 'summary', summary);
        res.end();
        captureInProgress = false;
    }
}

async function handleSignInStream(res: ServerResponse, url: URL) {
    if (runInProgress) {
        res.statusCode = 409;
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        sendEvent(res, 'summary', {
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            loginSuccess: false,
            withinTimeWindow: null,
            signStatus: null,
            signedSuccess: false,
            alreadySigned: false,
            account: null,
            task: null,
            error: 'Another sign-in task is already running.',
        } satisfies Summary);
        res.end();
        return;
    }

    const requestedOpenid = url.searchParams.get('openid')?.trim() ?? '';
    const openid = requestedOpenid || process.env.openid || '';
    const openids = parseOpenIds(openid);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    if (openids.length === 0) {
        sendEvent(res, 'summary', {
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            loginSuccess: false,
            withinTimeWindow: null,
            signStatus: null,
            signedSuccess: false,
            alreadySigned: false,
            account: null,
            task: null,
            error: 'Please capture or enter an OpenID before signing in.',
        } satisfies Summary);
        res.end();
        return;
    }

    runInProgress = true;
    const summary: Summary = {
        startedAt: new Date().toISOString(),
        loginSuccess: false,
        withinTimeWindow: null,
        signStatus: null,
        signedSuccess: false,
        alreadySigned: false,
        account: null,
        task: null,
        error: null,
    };

    const events = new EventEmitter<MainEvents>();

    events.on('start', (activeOpenid) => {
        sendEvent(res, 'start', { openid: activeOpenid, at: new Date().toISOString() });
    });

    events.on('wait', (time) => {
        sendEvent(res, 'wait', { durationMs: time, at: new Date().toISOString() });
    });

    events.on('log', (...args) => {
        sendEvent(res, 'log', {
            message: args.map((item) => formatLogPart(item)).join(' ').replace(/\s+/g, ' ').trim(),
            at: new Date().toISOString(),
        });
    });

    events.on('signInResult', (_openid, signInResult: AuthTokenResponse) => {
        summary.loginSuccess = true;
        summary.account = {
            userName: signInResult.userName,
            schoolName: signInResult.schoolName,
            accountNo: signInResult.accountNo,
        };
        sendEvent(res, 'signInResult', summary.account);
    });

    events.on('taskDetail', (_openid, taskDetail: TaskDetails) => {
        summary.withinTimeWindow = true;
        summary.task = {
            taskName: taskDetail.taskName,
            signStartTime: taskDetail.signStartTime,
            signEndTime: taskDetail.signEndTime,
        };
        sendEvent(res, 'taskDetail', summary.task);
    });

    events.on('signTimeInvalid', (_openid, startTime: string, endTime: string) => {
        summary.withinTimeWindow = false;
        summary.error = `Current time is outside the sign-in window: ${startTime} - ${endTime}.`;
        sendEvent(res, 'signTimeInvalid', {
            signStartTime: startTime,
            signEndTime: endTime,
            message: summary.error,
        });
    });

    events.on('recordStatus', (_openid, recordStatus: RecordStatus) => {
        summary.signStatus = recordStatus.signStatusName;
        summary.alreadySigned = recordStatus.signStatus === 0;
        sendEvent(res, 'recordStatus', {
            signStatus: recordStatus.signStatus,
            signStatusName: recordStatus.signStatusName,
            signTime: recordStatus.signTime,
            taskName: recordStatus.taskName,
        });
    });

    events.on('signRecordResponse', (_openid, signRecordResponse: boolean) => {
        summary.signedSuccess = signRecordResponse;
        sendEvent(res, 'signRecordResponse', {
            signedSuccess: signRecordResponse,
        });
    });

    events.on('error', (error) => {
        summary.error = serializeError(error);
        sendEvent(res, 'error', {
            message: summary.error,
        });
    });

    try {
        await main(openids, events);
    }
    catch (error) {
        summary.error = serializeError(error);
        sendEvent(res, 'error', {
            message: summary.error,
        });
    }
    finally {
        summary.completedAt = new Date().toISOString();
        sendEvent(res, 'summary', summary);
        res.end();
        runInProgress = false;
    }
}

const server = createServer(async (req, res) => {
    if (!req.url || !req.method) {
        sendJson(res, 400, { error: 'Bad Request' });
        return;
    }

    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    try {
        if (req.method === 'GET' && url.pathname === '/api/config') {
            sendJson(res, 200, readConfig());
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/debugger/status') {
            sendJson(res, 200, await getDebuggerStatus());
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/schedule') {
            sendJson(res, 200, await buildScheduleResponse(await loadScheduleConfig()));
            return;
        }

        if (req.method === 'POST' && url.pathname === '/api/config') {
            const payload = await readJson<{ openid?: string; openids?: string[] | string }>(req);
            const openids = payload.openids ?? payload.openid ?? '';
            await saveOpenId(openids);
            sendJson(res, 200, readConfig());
            return;
        }

        if (req.method === 'POST' && url.pathname === '/api/schedule') {
            const payload = await readJson<Partial<ScheduleConfig>>(req);
            const saved = await saveScheduleConfig(payload);
            applyRuntimeSchedule(saved);
            sendJson(res, 200, await buildScheduleResponse(saved));
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/openid/capture/stream') {
            await handleCaptureStream(res);
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/sign-in/stream') {
            await handleSignInStream(res, url);
            return;
        }

        const proxied = await maybeProxyWebDevServer(req, res, url.pathname, url.search);
        if (proxied) {
            return;
        }

        const served = await maybeServeStatic(res, url.pathname);
        if (served) {
            return;
        }

        sendJson(res, 404, { error: 'Not Found' });
    }
    catch (error) {
        sendJson(res, 500, { error: serializeError(error) });
    }
});

loadScheduleConfig()
    .then((config) => {
        applyRuntimeSchedule(config);
        server.listen(PORT, '127.0.0.1', () => {
            console.log(`Unsafe dorm server listening on http://127.0.0.1:${PORT}`);
            console.log(`Schedule runtime active: ${getRuntimeScheduleStatus().active ? 'yes' : 'no'}`);
        });
    })
    .catch((error) => {
        console.error('Failed to initialize schedule runtime:', error);
        process.exit(1);
    });
