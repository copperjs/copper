import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as stream from 'stream';
import * as unzipper from 'unzipper';
import * as mkdirp from 'mkdirp';
import * as uuid from 'uuid';
import * as puppeteer from 'puppeteer-core';
import fetch from 'node-fetch';
import { launch, Options, LaunchedChrome } from 'chrome-launcher';
import { logger } from '../logger';
import { CreateSessionError, SessionNotFound } from '../common/errors';
import { IWebSocketHandler } from '../common/websockets';
import { copperConfig } from './config';

export type SessionOptions = Omit<Options, 'handleSIGINT'>;
export type CreateSessionArgs = {
    chromeOptions?: SessionOptions;
    desiredCapabilities?: desiredCapabilities;
    capabilities?: {
        alwaysMatch?: desiredCapabilities;
        firstMatch?: desiredCapabilities[];
    };
};

export interface Session {
    chrome: LaunchedChrome;
    wsUrl: string;
    wsInfo: {
        Browser: string;
        'Protocol-Version': string;
        'User-Agent': string;
        'V8-Version': string;
        'WebKit-Version': string;
        webSocketDebuggerUrl: string;
    };
    puppeteer?: {
        browser: puppeteer.Browser;
        page: puppeteer.Page;
    };
}

const chromeOptionsPath = ['chromeOptions', 'goog:chromeOptions'] as const;

type desiredCapabilities = Partial<
    Record<
        typeof chromeOptionsPath[number],
        {
            args?: Array<string>;
            extensions?: Array<string>;
        }
    >
> & {
    browserName: 'chrome';
};

export type serializedSession = Session['wsInfo'] & {
    id: string;
    port: number;
    pid: number;
    webSocketDebuggerUrl: never;
};

export class SessionManager implements IWebSocketHandler {
    private sessions = new Map<string, Session>();
    private extensions = new Map<string, string>();
    private extensionsPending = new Map<string, Promise<string>>();

    private serializeSession(id: string, session: Session): serializedSession {
        return {
            ...session.wsInfo,
            id,
            port: session.chrome.port,
            pid: session.chrome.pid,
            webSocketDebuggerUrl: undefined as never,
        };
    }

    private getChromeOptions(desiredCapabilities: desiredCapabilities) {
        return desiredCapabilities['goog:chromeOptions'] || desiredCapabilities.chromeOptions;
    }

    private async saveExtensionLocally(extension: string, directory: string) {
        const data = Buffer.from(extension, 'base64');
        const checksum = crypto.createHash('md5').update(data).digest('hex');

        if (this.extensions.has(checksum)) {
            return this.extensions.get(checksum);
        }

        const promise =
            this.extensionsPending.get(checksum) ||
            new Promise<string>((resolve, reject) => {
                const file = path.join(directory, uuid.v4().toUpperCase());
                const readStream = stream.Readable.from(data);
                logger.info(`writing extension to ${file}`);
                readStream
                    .pipe(unzipper.Extract({ path: file }))
                    .on('error', (err) => reject(err))
                    .on('close', () => {
                        this.extensions.set(checksum, file);
                        this.extensionsPending.delete(checksum);
                        resolve(file);
                    });
            });
        this.extensionsPending.set(checksum, promise);
        return await promise;
    }

    private async handleExtensions(desiredCapabilities: desiredCapabilities, sessionId: string) {
        // https://github.com/chromium/chromium/blob/d7da0240cae77824d1eda25745c4022757499131/chrome/test/chromedriver/chrome_launcher.cc#L905
        const chromeOptions = this.getChromeOptions(desiredCapabilities);
        if (!chromeOptions?.extensions?.length) {
            return;
        }
        const extDir = path.join(os.tmpdir(), sessionId);
        await mkdirp(extDir);
        chromeOptions.args = chromeOptions.args || [];
        const extensions: string[] = chromeOptions.extensions;
        await Promise.all(
            extensions.map((extension) =>
                this.saveExtensionLocally(extension, extDir).then((file) =>
                    chromeOptions.args!.push(`--load-extension=${file}`),
                ),
            ),
        );
    }

    private async handleChromeProfile(desiredCapabilities: desiredCapabilities, sessionId: string) {
        // https://github.com/chromium/chromium/blob/d7da0240cae77824d1eda25745c4022757499131/chrome/test/chromedriver/chrome_launcher.cc#L1096
        const profilePath = path.join(os.tmpdir(), 'puppeteer_dev_chrome_profile-');
        await mkdirp(profilePath);
    }

    private parseSessionRequest(args: CreateSessionArgs = {}) {
        const capabilities = args.capabilities?.alwaysMatch ||
            args.capabilities?.firstMatch?.find(() => true) ||
            args.desiredCapabilities || { browserName: 'chrome' };
        const chromeOptions = args.chromeOptions;

        return { chromeOptions, capabilities };
    }

    async createSession(args: CreateSessionArgs = {}) {
        const id = uuid.v4().toUpperCase();
        const { capabilities, chromeOptions } = this.parseSessionRequest(args);

        try {
            await this.handleExtensions(capabilities, id);
            const w3cArgs = [...(this.getChromeOptions(capabilities)?.args || [])];
            const options: SessionOptions = Object.assign(
                {},
                chromeOptions,
                w3cArgs.length ? { chromeFlags: w3cArgs, ignoreDefaultFlags: true } : {},
            );

            const chrome = await launch(options);
            const wsInfo = await fetch(`http://localhost:${chrome.port}/json/version`).then((res) => res.json());
            const wsUrl = wsInfo.webSocketDebuggerUrl;
            const session: Session = { chrome, wsInfo, wsUrl };
            if (copperConfig.value.enableW3CProtocol) {
                const browser = await puppeteer.connect({ browserWSEndpoint: wsUrl });
                const page = (await browser.pages())[0];
                session.puppeteer = { browser, page };
            }
            this.sessions.set(id, session);
            return this.serializeSession(id, session);
        } catch (err) {
            logger.error({ err, id }, 'error creating a session');
            throw new CreateSessionError(err);
        }
    }

    async removeSession(id: string) {
        this.getSession(id); // throw if no session
        try {
            const session = this.sessions.get(id)!;
            await session.puppeteer?.browser?.disconnect();
            await session.chrome.kill();
        } catch (err) {
            logger.error({ err, id }, 'error removing a session');
        } finally {
            this.sessions.delete(id);
        }
    }

    getSession(id: string) {
        if (!this.sessions.has(id)) {
            throw new SessionNotFound(id);
        }

        const session = this.sessions.get(id)!;
        return this.serializeSession(id, session);
    }

    getWebSocketUrl(id: string) {
        this.getSession(id); // throw if no session
        const session = this.sessions.get(id)!;
        return session.wsUrl;
    }

    getPuppeteer(id: string) {
        this.getSession(id); // throw if no session
        const session = this.sessions.get(id)!;
        return session.puppeteer;
    }

    listSessions() {
        return Array.from(this.sessions.entries()).map(([id, session]) => this.serializeSession(id, session));
    }
}

export const sessionManager = new SessionManager();
