import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const LOG_DIR = path.join(ROOT, '日志');

export type ScheduleLogResult = '成功' | '失败' | '跳过';

function pad(value: number) {
    return String(value).padStart(2, '0');
}

function formatTimestamp(date = new Date()) {
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
    ].join('-');
}

function normalizeLine(value: string) {
    return value.replace(/\r?\n/g, ' ').trim();
}

export async function ensureScheduleLogDir() {
    await mkdir(LOG_DIR, { recursive: true });
    return LOG_DIR;
}

export async function writeScheduleLog(result: ScheduleLogResult, lines: string[], date = new Date()) {
    const logDir = await ensureScheduleLogDir();
    const fileName = `${formatTimestamp(date)}${result}.log`;
    const filePath = path.join(logDir, fileName);
    const content = `${lines.map((line) => normalizeLine(line)).join('\n')}\n`;
    await writeFile(filePath, content, 'utf8');
    return filePath;
}
