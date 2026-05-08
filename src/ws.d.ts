declare module 'ws' {
    import { EventEmitter } from 'node:events';

    export type RawData = Buffer | ArrayBuffer | Buffer[];

    class WebSocket extends EventEmitter {
        constructor(url: string);
        close(): void;
        send(data: string): void;
        on(event: 'open', listener: () => void): this;
        on(event: 'message', listener: (data: RawData) => void): this;
        on(event: 'error', listener: (error: Error) => void): this;
        on(event: 'close', listener: () => void): this;
    }

    export default WebSocket;
}
