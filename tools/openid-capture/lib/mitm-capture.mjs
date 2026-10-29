import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { ADDON_PATH } from './paths.mjs';
import { ensureCertificateTrusted } from './certificate.mjs';
import { createProxyController } from './proxy.mjs';
import {
    isPortOpen,
    readRecentLogLines,
    sleep,
    waitForFile,
} from './proc.mjs';

const MITM_START_TIMEOUT_MS = 10000;
const CERTIFICATE_TIMEOUT_MS = 10000;

export async function captureOpenId({ paths, port, timeoutMs, mitmdumpExecutable, onStatus }) {
    mkdirSync(paths.home, { recursive: true });
    await writeFile(paths.captureFile, '', 'utf8');

    const logFd = openSync(paths.logFile, 'a');
    const proxy = await createProxyController();
    const originalProxy = proxy ? await proxy.read() : null;

    let child = null;
    let proxyApplied = false;
    let cleaned = false;

    const cleanup = async () => {
        if (cleaned) {
            return;
        }
        cleaned = true;

        process.off('SIGINT', handleSignal);
        process.off('SIGTERM', handleSignal);

        if (child && child.exitCode === null && !child.killed) {
            child.kill();
        }

        if (proxy && originalProxy && proxyApplied) {
            try {
                await proxy.apply(originalProxy);
                onStatus('已恢复原系统代理设置。');
            }
            catch (error) {
                onStatus(`恢复系统代理失败，请手动检查系统代理设置：${error instanceof Error ? error.message : String(error)}`);
            }
        }

        try {
            closeSync(logFd);
        }
        catch {
            // 关闭日志描述符失败不影响结果的输出。
        }
    };

    const handleSignal = () => {
        cleanup().finally(() => process.exit(130));
    };

    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);

    try {
        const childState = { exited: false, detail: '' };
        child = spawn(mitmdumpExecutable, [
            '-q',
            '-s',
            ADDON_PATH,
            '--listen-host',
            '127.0.0.1',
            '--listen-port',
            String(port),
        ], {
            env: {
                ...process.env,
                MITM_OPENID_CAPTURE_FILE: paths.captureFile,
            },
            windowsHide: true,
            stdio: ['ignore', logFd, logFd],
        });

        child.on('error', (error) => {
            childState.exited = true;
            childState.detail = error.message;
        });
        child.on('exit', (code, signal) => {
            childState.exited = true;
            childState.detail = signal ? `信号 ${signal}` : `退出码 ${code ?? -1}`;
        });

        await waitForMitmdump(childState, paths, port);

        const shouldTrustCertificate = process.platform === 'win32' || process.platform === 'darwin';
        if (shouldTrustCertificate) {
            await waitForFile(paths.certificateFile, CERTIFICATE_TIMEOUT_MS);
            await ensureCertificateTrusted(paths.certificateFile, onStatus);
        }
        else {
            onStatus(`当前平台不会自动信任 CA 证书。微信小程序使用 NSS 证书库，请把 ${paths.certificateFile} 导入 ~/.pki/nssdb，详见 README。`);
        }

        if (proxy && originalProxy) {
            await proxy.apply(proxy.buildCaptureSettings(originalProxy, port));
            proxyApplied = true;
            onStatus(`系统代理已切换到 127.0.0.1:${port}。请在微信中打开小程序并点一次登录。`);
        }
        else {
            onStatus(`当前环境没有可用的系统代理设置工具。请手动把系统代理设置为 127.0.0.1:${port}，然后在小程序中点一次登录。`);
        }

        return await waitForOpenId(paths, timeoutMs, childState);
    }
    finally {
        await cleanup();
    }
}

async function waitForMitmdump(childState, paths, port) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < MITM_START_TIMEOUT_MS) {
        if (childState.exited) {
            throw new Error(`mitmdump 启动失败：${childState.detail}${await describeLog(paths.logFile)}`);
        }

        if (await isPortOpen(port)) {
            return;
        }

        await sleep(500);
    }

    throw new Error(`mitmdump 没有在 10 秒内监听端口 ${port}。${await describeLog(paths.logFile)}`);
}

async function waitForOpenId(paths, timeoutMs, childState) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        if (childState.exited) {
            throw new Error(`mitmdump 已退出（${childState.detail}）。${await describeLog(paths.logFile)}`);
        }

        if (existsSync(paths.captureFile)) {
            const raw = await readFile(paths.captureFile, 'utf8');
            const lines = raw
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line.length > 0);

            for (const line of lines.reverse()) {
                const record = parseCaptureRecord(line);
                if (record) {
                    return record;
                }
            }
        }

        await sleep(1000);
    }

    throw new Error(
        `等待 OpenID 超时（${Math.round(timeoutMs / 1000)} 秒）。`
        + `请确认小程序已打开并点了一次登录。${await describeLog(paths.logFile)}`,
    );
}

function parseCaptureRecord(line) {
    try {
        const record = JSON.parse(line);
        if (record && typeof record.openid === 'string' && record.openid.trim()) {
            return {
                openid: record.openid.trim(),
                matchedUrl: typeof record.matched_url === 'string' ? record.matched_url : '',
            };
        }
    }
    catch {
        // 跳过不完整的 JSON 行。
    }

    return null;
}

async function describeLog(logFile) {
    const tail = await readRecentLogLines(logFile);
    return tail ? `日志：${tail}` : '日志为空。';
}
