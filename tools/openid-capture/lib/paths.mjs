import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const ADDON_PATH = path.join(TOOL_DIR, 'addon', 'mitm_openid_addon.py');
export const DEFAULT_HOME_DIR = path.join(TOOL_DIR, '.cache');

export function resolveCapturePaths(homeDir) {
    const home = path.resolve(homeDir || DEFAULT_HOME_DIR);
    const certificateName = process.platform === 'win32'
        ? 'mitmproxy-ca-cert.cer'
        : 'mitmproxy-ca-cert.pem';

    return {
        home,
        venvDir: path.join(home, 'venv'),
        captureFile: path.join(home, 'openid-capture.jsonl'),
        logFile: path.join(home, 'mitmdump.log'),
        certificateFile: path.join(homedir(), '.mitmproxy', certificateName),
    };
}

export function getVenvBinDir(venvDir) {
    if (process.platform !== 'win32') {
        return path.join(venvDir, 'bin');
    }

    const scriptsDir = path.join(venvDir, 'Scripts');
    if (existsSync(scriptsDir)) {
        return scriptsDir;
    }

    const binDir = path.join(venvDir, 'bin');
    if (existsSync(binDir)) {
        return binDir;
    }

    return scriptsDir;
}

export function getExecutableName(base) {
    return process.platform === 'win32' ? `${base}.exe` : base;
}
