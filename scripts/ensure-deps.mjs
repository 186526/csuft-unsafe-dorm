import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const webDir = path.join(rootDir, 'web');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function hasPackage(dir, packageName) {
    return existsSync(path.join(dir, 'node_modules', packageName, 'package.json'));
}

function runNpmInstall(dir, label) {
    console.log(`[setup] Installing ${label} dependencies...`);
    const result = spawnSync(npmCommand, ['install'], {
        cwd: dir,
        stdio: 'inherit',
    });

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

let installedAnything = false;

if (!hasPackage(rootDir, 'concurrently') || !hasPackage(rootDir, 'tsx')) {
    runNpmInstall(rootDir, 'root');
    installedAnything = true;
}

if (!hasPackage(webDir, 'vite') || !hasPackage(webDir, 'react')) {
    runNpmInstall(webDir, 'web');
    installedAnything = true;
}

if (!installedAnything) {
    console.log('[setup] Dependencies already installed.');
}
