import axios from "axios";

export async function pushBark(
    api: string,
    deviceKey: string,
    title: string,
    body: string,
): Promise<void> {
    const baseUrl = api.replace(/\/+$/, "");

    try {
        await axios.post(`${baseUrl}/push`, {
            device_key: deviceKey,
            title,
            body,
        });
        return;
    }
    catch {
        const url = `${baseUrl}/${encodeURIComponent(deviceKey)}/${encodeURIComponent(title)}/${encodeURIComponent(body)}`;
        await axios.get(url);
    }
}
