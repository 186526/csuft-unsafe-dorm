import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getExecutableName, getVenvBinDir } from './paths.mjs';
import { commandExists, runCommand, runCommandCaptureOutput } from './proc.mjs';

export async function ensureMitmdumpReady(paths, onStatus) {
    mkdirSync(paths.home, { recursive: true });

    const existingExecutable = await resolveMitmdumpExecutable(paths, null);
    if (existingExecutable) {
        return existingExecutable;
    }

    const pythonRuntime = await getPythonRuntime(paths);
    if (!pythonRuntime) {
        throw new Error(
            '没有找到 mitmdump，也没有找到可用的 Python 3。请安装 Python 3.12 或更高版本，'
            + '或设置 MITM_PYTHON_PATH 指向 python 可执行文件。',
        );
    }

    onStatus('没有找到 mitmdump，正在创建虚拟环境并安装 mitmproxy…');
    const venvPython = await ensureMitmVenv(paths, pythonRuntime, onStatus);
    await installMitmproxyPackage(paths, venvPython, onStatus);

    const installedExecutable = await resolveMitmdumpExecutable(paths);
    if (!installedExecutable) {
        throw new Error(`mitmproxy 安装完成，但没有在 ${paths.venvDir} 找到 mitmdump。`);
    }

    onStatus('mitmproxy 已安装完成。');
    return installedExecutable;
}

async function getPythonRuntime(paths) {
    const candidates = [];

    const configuredPython = process.env.MITM_PYTHON_PATH?.trim();
    if (configuredPython) {
        candidates.push({ command: configuredPython, args: [] });
    }

    if (process.platform === 'win32' && await commandExists('py')) {
        candidates.push({ command: 'py', args: ['-3'] });
    }

    for (const command of ['python', 'python3']) {
        if (await commandExists(command)) {
            candidates.push({ command, args: [] });
        }
    }

    for (const candidate of candidates) {
        if (await canUsePythonRuntime(candidate, paths)) {
            return candidate;
        }
    }

    return null;
}

async function canUsePythonRuntime(runtime, paths) {
    try {
        const output = await runCommandCaptureOutput(
            runtime.command,
            [...runtime.args, '-c', 'import os, sys; print(sys.executable); print(sys.version)'],
            paths.home,
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

async function getPythonRuntimeExecutable(runtime, paths) {
    const output = await runCommandCaptureOutput(
        runtime.command,
        [...runtime.args, '-c', 'import sys; print(sys.executable)'],
        paths.home,
    );
    return output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? '';
}

export async function resolveMitmdumpExecutable(paths, pythonRuntime) {
    const localMitmdump = getVenvMitmdumpPath(paths.venvDir);
    if (existsSync(localMitmdump)) {
        return localMitmdump;
    }

    try {
        const output = await runCommandCaptureOutput(
            process.platform === 'win32' ? 'where.exe' : 'which',
            ['mitmdump'],
            paths.home,
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
        // PATH 中没有 mitmdump，继续尝试其它位置。
    }

    if (!pythonRuntime) {
        return null;
    }

    try {
        const scriptName = getExecutableName('mitmdump');
        const output = await runCommandCaptureOutput(
            pythonRuntime.command,
            [
                ...pythonRuntime.args,
                '-c',
                `import os, sysconfig; print(os.path.join(sysconfig.get_path("scripts"), "${scriptName}"))`,
            ],
            paths.home,
        );
        const candidate = output.trim();
        if (candidate.length > 0 && existsSync(candidate)) {
            return candidate;
        }
    }
    catch {
        // Python 的 scripts 目录不可用时继续返回空结果。
    }

    return null;
}

async function ensureMitmVenv(paths, pythonRuntime, onStatus) {
    const venvPython = getVenvPythonPath(paths.venvDir);
    const venvConfigPath = path.join(paths.venvDir, 'pyvenv.cfg');
    let shouldRecreate = !existsSync(venvPython) || !existsSync(venvConfigPath);

    if (!shouldRecreate) {
        try {
            const [venvConfig, runtimeExecutable] = await Promise.all([
                readFile(venvConfigPath, 'utf8'),
                getPythonRuntimeExecutable(pythonRuntime, paths),
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
                (configExecutable && normalizedRuntimeExecutable && configExecutable !== normalizedRuntimeExecutable)
                || configExecutable.includes('\\msys64\\')
            ) {
                shouldRecreate = true;
                onStatus('已有虚拟环境来自其它 Python，正在重建。');
            }
        }
        catch {
            shouldRecreate = true;
        }
    }

    if (shouldRecreate) {
        onStatus('正在创建工具专用的 Python 虚拟环境…');
        await runCommand(
            pythonRuntime.command,
            [
                ...pythonRuntime.args,
                '-m',
                'venv',
                ...(existsSync(paths.venvDir) ? ['--clear'] : []),
                paths.venvDir,
            ],
            paths.home,
            { onOutput: onStatus },
        );
    }

    try {
        await runCommand(venvPython, ['-m', 'pip', '--version'], paths.home);
    }
    catch {
        onStatus('虚拟环境中缺少 pip，正在初始化…');
        await runCommand(venvPython, ['-m', 'ensurepip', '--upgrade'], paths.home, { onOutput: onStatus });
    }

    return venvPython;
}

async function installMitmproxyPackage(paths, venvPython, onStatus) {
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
        await runCommand(venvPython, baseArgs, paths.home, { onOutput: onStatus });
        return;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const looksLikeCertificateError =
            /CERTIFICATE_VERIFY_FAILED|SSLCertVerificationError|unable to get local issuer certificate/i.test(message);

        if (!looksLikeCertificateError) {
            throw error;
        }

        onStatus('pip 访问默认源时遇到证书校验问题，正在尝试镜像源…');
    }

    let lastError = null;
    for (const mirror of getPipMirrorCandidates()) {
        try {
            onStatus(`正在通过 ${mirror.label} 安装 mitmproxy…`);
            const args = [...baseArgs, '-i', mirror.indexUrl];
            if (mirror.trustedHost) {
                args.push('--trusted-host', mirror.trustedHost);
                if (mirror.trustedHost === 'pypi.org') {
                    args.push('--trusted-host', 'files.pythonhosted.org');
                }
            }

            await runCommand(venvPython, args, paths.home, { onOutput: onStatus });
            return;
        }
        catch (mirrorError) {
            lastError = mirrorError;
        }
    }

    throw new Error(
        `pip 默认源证书校验失败，镜像源重试也没有成功：${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
}

function getPipMirrorCandidates() {
    const customIndexUrl = process.env.PIP_INDEX_URL?.trim();
    const customTrustedHost = process.env.PIP_TRUSTED_HOST?.trim();
    const mirrors = [];

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
            label: '自定义镜像源',
            indexUrl: customIndexUrl,
            trustedHost,
        });
    }

    mirrors.push(
        {
            label: 'PyPI 官方源',
            indexUrl: 'https://pypi.org/simple',
            trustedHost: 'pypi.org',
        },
        {
            label: '清华镜像源',
            indexUrl: 'https://pypi.tuna.tsinghua.edu.cn/simple',
            trustedHost: 'pypi.tuna.tsinghua.edu.cn',
        },
        {
            label: '阿里云镜像源',
            indexUrl: 'https://mirrors.aliyun.com/pypi/simple',
            trustedHost: 'mirrors.aliyun.com',
        },
    );

    return mirrors;
}

function getVenvPythonPath(venvDir) {
    return path.join(getVenvBinDir(venvDir), getExecutableName('python'));
}

function getVenvMitmdumpPath(venvDir) {
    return path.join(getVenvBinDir(venvDir), getExecutableName('mitmdump'));
}
