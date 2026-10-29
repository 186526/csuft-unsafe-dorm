import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { escapePowerShell, runCommand, runPowerShell } from './proc.mjs';

export async function ensureCertificateTrusted(certificateFile, onStatus) {
    if (!existsSync(certificateFile)) {
        throw new Error(`未找到 mitmproxy CA 证书：${certificateFile}`);
    }

    if (process.platform === 'win32') {
        await trustCertificateOnWindows(certificateFile, onStatus);
        return;
    }

    if (process.platform === 'darwin') {
        await trustCertificateOnMac(certificateFile, onStatus);
        return;
    }

    throw new Error('只有 Windows 和 macOS 支持自动信任 CA 证书。');
}

async function trustCertificateOnWindows(certificateFile, onStatus) {
    const trusted = await runPowerShell(`
        $certPath = '${escapePowerShell(certificateFile)}'
        $thumbprint = (Get-PfxCertificate $certPath).Thumbprint
        $existing = Get-ChildItem Cert:\\CurrentUser\\Root | Where-Object { $_.Thumbprint -eq $thumbprint } | Select-Object -First 1
        if ($null -ne $existing) {
            Write-Output 'trusted'
        }
    `);
    if (trusted.includes('trusted')) {
        onStatus('mitmproxy CA 证书已受信任。');
        return;
    }

    onStatus('正在把 mitmproxy CA 证书加入当前用户根证书库…');
    await runCommand('certutil.exe', ['-user', '-addstore', 'Root', certificateFile]);
}

async function trustCertificateOnMac(certificateFile, onStatus) {
    try {
        await runCommand('security', ['verify-cert', '-c', certificateFile]);
        onStatus('mitmproxy CA 证书已受信任。');
        return;
    }
    catch {
        // 尚未受信任，继续安装。
    }

    onStatus('正在把 mitmproxy CA 证书加入登录钥匙串…');
    const keychain = path.join(homedir(), 'Library', 'Keychains', 'login.keychain-db');
    await runCommand('security', ['add-trusted-cert', '-r', 'trustRoot', '-k', keychain, certificateFile]);
}
