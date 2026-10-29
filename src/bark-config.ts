import { readFile } from "node:fs/promises";
import { parse } from "yaml";

export type BarkUser = {
    openid: string;
    name?: string;
    deviceKey?: string;
    api?: string;
};

export type BarkConfig = {
    api: string;
    globalDeviceKey: string;
    users: BarkUser[];
};

const DEFAULT_CONFIG_PATH = "bark.yaml";

export function resolveBarkConfigPath(): string {
    return process.env.BARK_CONFIG?.trim() || DEFAULT_CONFIG_PATH;
}

export async function loadBarkConfig(configPath = resolveBarkConfigPath()): Promise<BarkConfig> {
    let raw: string;
    try {
        raw = await readFile(configPath, "utf8");
    }
    catch (error) {
        throw new Error(`无法读取 Bark 配置文件 ${configPath}：${formatError(error)}`);
    }

    let document: unknown;
    try {
        document = parse(raw);
    }
    catch (error) {
        throw new Error(`Bark 配置文件 ${configPath} 不是有效的 YAML：${formatError(error)}`);
    }

    return validateBarkConfig(document, configPath);
}

function validateBarkConfig(document: unknown, configPath: string): BarkConfig {
    if (!isRecord(document)) {
        throw new Error(`Bark 配置文件 ${configPath} 的顶层必须是对象。`);
    }

    if (!isRecord(document.bark)) {
        throw new Error(`Bark 配置文件 ${configPath} 缺少 bark 配置块。`);
    }

    const api = readRequiredString(document.bark.api, "bark.api", configPath);
    const globalDeviceKey = readRequiredString(document.bark.globalDeviceKey, "bark.globalDeviceKey", configPath);

    if (!Array.isArray(document.users) || document.users.length === 0) {
        throw new Error(`Bark 配置文件 ${configPath} 的 users 必须是非空数组。`);
    }

    const seenOpenids = new Set<string>();
    const users = document.users.map((item, index) => {
        const label = `users[${index}]`;
        if (!isRecord(item)) {
            throw new Error(`Bark 配置文件 ${configPath} 的 ${label} 必须是对象。`);
        }

        const openid = readRequiredString(item.openid, `${label}.openid`, configPath);
        if (seenOpenids.has(openid)) {
            throw new Error(`Bark 配置文件 ${configPath} 中 openid 重复：${openid}`);
        }
        seenOpenids.add(openid);

        const user: BarkUser = { openid };
        const name = readOptionalString(item.name, `${label}.name`, configPath);
        if (name) {
            user.name = name;
        }

        if (item.bark !== undefined) {
            if (!isRecord(item.bark)) {
                throw new Error(`Bark 配置文件 ${configPath} 的 ${label}.bark 必须是对象。`);
            }

            const userDeviceKey = readOptionalString(item.bark.deviceKey, `${label}.bark.deviceKey`, configPath);
            if (userDeviceKey) {
                user.deviceKey = userDeviceKey;
            }

            const userApi = readOptionalString(item.bark.api, `${label}.bark.api`, configPath);
            if (userApi) {
                user.api = userApi;
            }
        }

        return user;
    });

    return { api, globalDeviceKey, users };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(value: unknown, label: string, configPath: string): string {
    const text = readOptionalString(value, label, configPath);
    if (!text) {
        throw new Error(`Bark 配置文件 ${configPath} 的 ${label} 必须是非空字符串。`);
    }

    return text;
}

function readOptionalString(value: unknown, label: string, configPath: string): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (typeof value !== "string") {
        throw new Error(`Bark 配置文件 ${configPath} 的 ${label} 必须是字符串。`);
    }

    const text = value.trim();
    return text.length > 0 ? text : undefined;
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
