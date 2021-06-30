import { FastifyPluginCallback } from 'fastify';
import { UnsupportedActionError } from '../common/errors';
import { addWsUrl } from '../common/utils';
import { copperConfig } from './config';
import { CreateSessionArgs, sessionManager } from './sessionManager';

export type withSessionId = { Params: { sessionId: string } };

export const registerRoutes: FastifyPluginCallback = (app, opts, done) => {
    app.get('/status', async () => {
        return { ready: true, message: 'Copper Is Ready' };
    });

    app.get('/sessions', async () => {
        const value = sessionManager.listSessions();
        return { statue: 0, value };
    });

    app.post<{ Body: CreateSessionArgs }>('/session', async (req) => {
        const session = await sessionManager.createSession(req.body);
        const value = addWsUrl(req, session);
        return { status: 0, value, sessionId: session.id };
    });

    app.get<withSessionId>('/session/:sessionId', async (req) => {
        const value = sessionManager.getSession(req.params.sessionId);
        return { status: 0, value, sessionId: value.id };
    });

    app.delete<withSessionId>('/session/:sessionId', async (req) => {
        await sessionManager.removeSession(req.params.sessionId);
        return { status: 0, value: null, sessionId: null, state: 'success' };
    });

    app.all<withSessionId>('/session/:sessionId/*', async (req) => {
        if (!copperConfig.value.enableW3CProtocol) {
            throw new UnsupportedActionError(`unsupported action: ${req.url}`);
        }
        return { status: 0, value: null, state: 'success' };
    });

    done();
};
