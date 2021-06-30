import * as puppeteer from 'puppeteer';
import { expect } from 'chai';
import { StandaloneServer } from '../src/standalone/server';
import { copperConfig } from '../src/standalone/config';

const PORT = 9115;

describe('standalone e2e', () => {
    let server: StandaloneServer;
    let browser: puppeteer.Browser;
    let page: puppeteer.Page;

    before(async () => {
        copperConfig.value = { defaultSessionOptions: { chromeFlags: ['--headless', '--disable-gpu'] } };
        server = new StandaloneServer({ port: PORT, logLevel: 'silent' });
        await server.listen();
        browser = await puppeteer.connect({ browserWSEndpoint: `ws://localhost:${PORT}` });
        page = (await browser.pages())[0];
    });

    it('has title "Google"', async () => {
        await page.goto('https://google.com', { waitUntil: 'networkidle0' });
        const title = await page.title();
        expect(title).to.equal('Google');
    });

    it('Simple type & click', async () => {
        await page.type('input[name=q]', 'copper', { delay: 100 });
        await page.click('input[type="submit"]');
    });

    after(async () => {
        await browser.close();
        await server.stop();
    });
});
