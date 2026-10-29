import {
    escapePowerShell,
    runCommand,
    runCommandCaptureOutput,
    runPowerShell,
} from './proc.mjs';

const WINDOWS_PROXY_KEY = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const GNOME_PROXY_SCHEMA = 'org.gnome.system.proxy';

export async function createProxyController() {
    if (process.platform === 'win32') {
        return createWindowsProxyController();
    }

    if (process.platform === 'darwin') {
        return createMacProxyController();
    }

    return await createGnomeProxyController();
}

function mergeBypassList(current, extra) {
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

function createWindowsProxyController() {
    return {
        async read() {
            const output = await runPowerShell(`
                $path = '${WINDOWS_PROXY_KEY}'
                $item = Get-ItemProperty $path
                [pscustomobject]@{
                    enabled = [int]($item.ProxyEnable)
                    server = [string]($item.ProxyServer)
                    bypass = [string]($item.ProxyOverride)
                    autoConfigUrl = [string]($item.AutoConfigURL)
                } | ConvertTo-Json -Compress
            `);
            const raw = JSON.parse(output);

            return {
                enabled: Number(raw.enabled) === 1,
                server: raw.server ?? '',
                bypass: raw.bypass ?? '',
                autoConfigUrl: raw.autoConfigUrl ?? '',
            };
        },

        buildCaptureSettings(original, port) {
            return {
                enabled: true,
                server: `127.0.0.1:${port}`,
                bypass: mergeBypassList(original.bypass, ['localhost', '127.0.0.1', '<local>']),
                autoConfigUrl: original.autoConfigUrl,
            };
        },

        async apply(settings) {
            const autoConfigBlock = settings.autoConfigUrl
                ? `Set-ItemProperty $path AutoConfigURL '${escapePowerShell(settings.autoConfigUrl)}'`
                : `if ((Get-ItemProperty $path).PSObject.Properties.Name -contains 'AutoConfigURL') {
                    Remove-ItemProperty $path AutoConfigURL -ErrorAction SilentlyContinue
                }`;

            await runPowerShell(`
                $path = '${WINDOWS_PROXY_KEY}'
                Set-ItemProperty $path ProxyEnable ${settings.enabled ? 1 : 0}
                Set-ItemProperty $path ProxyServer '${escapePowerShell(settings.server)}'
                Set-ItemProperty $path ProxyOverride '${escapePowerShell(settings.bypass)}'
                ${autoConfigBlock}
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
            `);
        },
    };
}

function createMacProxyController() {
    return {
        async read() {
            const service = await getMacNetworkService();
            if (!service) {
                return { enabled: false, server: '', bypass: '', autoConfigUrl: '' };
            }

            const output = await runCommandCaptureOutput('networksetup', ['-getwebproxy', service]);
            const enabled = /^Enabled:\s*Yes$/im.test(output);
            const host = output.match(/^Server:\s*(.*)$/im)?.[1]?.trim() ?? '';
            const port = output.match(/^Port:\s*(.*)$/im)?.[1]?.trim() ?? '';

            return {
                enabled,
                server: host && port ? `${host}:${port}` : host,
                bypass: '',
                autoConfigUrl: '',
            };
        },

        buildCaptureSettings(original, port) {
            return {
                enabled: true,
                server: `127.0.0.1:${port}`,
                bypass: original.bypass,
                autoConfigUrl: original.autoConfigUrl,
            };
        },

        async apply(settings) {
            const service = await getMacNetworkService();
            if (!service) {
                return;
            }

            const [host, port = '80'] = String(settings.server ?? '').split(':');
            if (settings.enabled && host) {
                await runCommand('networksetup', ['-setwebproxy', service, host, port]);
                await runCommand('networksetup', ['-setwebproxystate', service, 'on']);
                return;
            }

            await runCommand('networksetup', ['-setwebproxystate', service, 'off']);
        },
    };
}

async function getMacNetworkService() {
    const output = await runCommandCaptureOutput('networksetup', ['-listallnetworkservices']);
    return output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith('An asterisk')) ?? null;
}

async function createGnomeProxyController() {
    try {
        await runCommandCaptureOutput('gsettings', ['get', GNOME_PROXY_SCHEMA, 'mode']);
        await runCommandCaptureOutput('gsettings', ['get', GNOME_PROXY_SCHEMA, 'ignore-hosts']);
    }
    catch {
        return null;
    }

    return {
        async read() {
            const [
                mode,
                autoConfigUrl,
                httpServer,
                httpsServer,
                ignoreHosts,
            ] = await Promise.all([
                readGnomeKey(GNOME_PROXY_SCHEMA, 'mode'),
                readGnomeKey(GNOME_PROXY_SCHEMA, 'autoconfig-url'),
                readGnomeServer('http'),
                readGnomeServer('https'),
                readGnomeKey(GNOME_PROXY_SCHEMA, 'ignore-hosts'),
            ]);

            return {
                mode,
                autoConfigUrl,
                httpServer,
                httpsServer,
                ignoreHosts: parseGnomeStringArray(ignoreHosts),
            };
        },

        buildCaptureSettings(original, port) {
            return {
                mode: 'manual',
                autoConfigUrl: original.autoConfigUrl,
                httpServer: `127.0.0.1:${port}`,
                httpsServer: `127.0.0.1:${port}`,
                ignoreHosts: mergeGnomeIgnoreHosts(original.ignoreHosts),
            };
        },

        async apply(settings) {
            await writeGnomeKey(GNOME_PROXY_SCHEMA, 'autoconfig-url', quoteGnomeValue(settings.autoConfigUrl));

            if (settings.mode !== 'manual') {
                await writeGnomeKey(GNOME_PROXY_SCHEMA, 'mode', quoteGnomeValue(settings.mode));
            }

            await writeGnomeServer('http', settings.httpServer);
            await writeGnomeServer('https', settings.httpsServer);
            await writeGnomeKey(
                GNOME_PROXY_SCHEMA,
                'ignore-hosts',
                formatGnomeStringArray(settings.ignoreHosts),
            );

            if (settings.mode === 'manual') {
                await writeGnomeKey(GNOME_PROXY_SCHEMA, 'mode', quoteGnomeValue('manual'));
            }
        },
    };
}

function mergeGnomeIgnoreHosts(current) {
    const values = new Set([...current, 'localhost', '127.0.0.1', '::1']);
    return Array.from(values);
}

async function readGnomeKey(schema, key) {
    return parseGnomeValue(await runCommandCaptureOutput('gsettings', ['get', schema, key]));
}

async function writeGnomeKey(schema, key, value) {
    await runCommand('gsettings', ['set', schema, key, value]);
}

async function readGnomeServer(protocol) {
    const [host, port] = await Promise.all([
        readGnomeKey(`${GNOME_PROXY_SCHEMA}.${protocol}`, 'host'),
        readGnomeKey(`${GNOME_PROXY_SCHEMA}.${protocol}`, 'port'),
    ]);

    return host ? `${host}:${port}` : '';
}

async function writeGnomeServer(protocol, server) {
    const [host, port = '0'] = String(server ?? '').split(':');
    await writeGnomeKey(`${GNOME_PROXY_SCHEMA}.${protocol}`, 'host', quoteGnomeValue(host));
    await writeGnomeKey(`${GNOME_PROXY_SCHEMA}.${protocol}`, 'port', port);
}

function parseGnomeValue(raw) {
    const value = raw.trim();
    if (value.startsWith("'") && value.endsWith("'")) {
        return value.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    }

    return value;
}

function parseGnomeStringArray(raw) {
    return Array.from(raw.matchAll(/'((?:[^'\\]|\\.)*)'/g))
        .map((match) => match[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
}

function quoteGnomeValue(value) {
    return `'${String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function formatGnomeStringArray(values) {
    return `[${values.map((value) => quoteGnomeValue(value)).join(', ')}]`;
}
