import process from "node:process";
import EventEmitter from 'node:events';
import { pathToFileURL } from 'node:url';
import main from './main.js';
import type { MainEvents } from './main.js';
import 'dotenv/config';

export type { MainEvents } from './main.js';

interface LogEvents {
    log: [...args: any[]];
    error: [...args: any[]];
}

export async function mainLoop() {
    if (!process.env.openid) {
        throw new Error("请在环境变量中设置 openid。");
    }

    const openids = process.env.openid.split(',')
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0);

    const events = new EventEmitter<MainEvents>();
    const logEvents = new EventEmitter<LogEvents>();

    logEvents.on('log', (...args) => {
        console.log(...args);
    });

    logEvents.on('error', (...args) => {
        console.error(...args);
    });

    events.on('log', (...args) => {
        logEvents.emit('log', ...args);
    });

    events.on('error', (error) => {
        logEvents.emit('error', '发生错误！', error);
    });

    events.on('start', (openid) => {
        logEvents.emit('log', `开始处理 openid: ${openid}`);
    });

    events.on('finish', (openid) => {
        logEvents.emit('log', `处理结束 openid: ${openid}`);
    });

    events.on('destroy', () => {
        logEvents.removeAllListeners();
        events.removeAllListeners();
    });

    await main(openids, events);
}

const entryFile = process.argv[1];
const isDirectRun = !!entryFile && import.meta.url === pathToFileURL(entryFile).href;

if (isDirectRun) {
    mainLoop().catch((error) => {
        console.error('mainLoop 执行失败:', error);
        process.exitCode = 1;
    });
}
