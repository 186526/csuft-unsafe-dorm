#!/usr/bin/env node

import process from 'node:process';
import { parseArgs } from 'node:util';
import { DEFAULT_HOME_DIR, resolveCapturePaths } from './lib/paths.mjs';
import { ensureMitmdumpReady } from './lib/python.mjs';
import { captureOpenId } from './lib/mitm-capture.mjs';

const HELP = `用法：openid-capture [选项]

启动本地 mitmproxy，抓取一次 getOpenidByJsCode 响应，把 OpenID 打印到标准输出。

选项：
  --port <端口>       mitmproxy 监听端口，默认 8866
  --timeout <秒>      等待 OpenID 的超时时间，默认 120
  --home <目录>       运行文件目录（虚拟环境、日志、抓包文件）
  -h, --help          显示帮助

环境变量：
  OPENID_CAPTURE_HOME  等价于 --home，默认 ${DEFAULT_HOME_DIR}
  MITM_PYTHON_PATH     指定用于安装 mitmproxy 的 Python
  PIP_INDEX_URL        指定 pip 镜像源
`;

async function main() {
    const { values } = parseArgs({
        options: {
            port: { type: 'string' },
            timeout: { type: 'string' },
            home: { type: 'string' },
            help: { type: 'boolean', short: 'h' },
        },
    });

    if (values.help) {
        process.stdout.write(HELP);
        return;
    }

    const port = parsePositiveInteger(values.port, 8866, '--port');
    const timeoutSeconds = parsePositiveInteger(values.timeout, 120, '--timeout');
    const paths = resolveCapturePaths(
        values.home ?? process.env.OPENID_CAPTURE_HOME ?? DEFAULT_HOME_DIR,
    );

    const onStatus = (message) => {
        process.stderr.write(`[capture] ${message}\n`);
    };

    const mitmdumpExecutable = await ensureMitmdumpReady(paths, onStatus);
    onStatus(`mitmdump：${mitmdumpExecutable}`);

    const result = await captureOpenId({
        paths,
        port,
        timeoutMs: timeoutSeconds * 1000,
        mitmdumpExecutable,
        onStatus,
    });

    if (result.matchedUrl) {
        process.stderr.write(`[capture] 匹配地址：${result.matchedUrl}\n`);
    }

    process.stdout.write(`${result.openid}\n`);
}

function parsePositiveInteger(rawValue, defaultValue, optionName) {
    if (rawValue === undefined) {
        return defaultValue;
    }

    const value = Number(rawValue);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${optionName} 需要正整数。`);
    }

    return value;
}

try {
    await main();
}
catch (error) {
    process.stderr.write(`[capture] 失败：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
}
