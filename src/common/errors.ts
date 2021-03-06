import { StatusCodes } from 'http-status-codes';
import { FastifyPluginCallback } from 'fastify';
import { logger } from '../logger';
export class BaseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = new.target.name;
    }
}

export class CopperError extends BaseError {
    /**
     *
     * @param {string} message - error message (usually same as error)
     * @param {string} error  - a constant message (e.g entity not found)
     * @param {number} statusCode
     */
    constructor(public message: string, public error: string, public statusCode = StatusCodes.BAD_REQUEST) {
        super(message);
    }

    toJSON() {
        return {
            message: this.message,
            error: this.error,
        };
    }
}

export class SessionNotFound extends CopperError {
    constructor(sessionId: string) {
        super(`cannot find session with id ${sessionId}`, 'session not found', StatusCodes.NOT_FOUND);
    }
}

export class CreateSessionError extends CopperError {
    constructor(error: string) {
        super(error, 'failed creating a session', StatusCodes.INTERNAL_SERVER_ERROR);
    }
}

export class UnsupportedActionError extends CopperError {
    constructor(error: string) {
        super(error, 'unsupported action', StatusCodes.NOT_IMPLEMENTED);
    }
}

export class NoMatchingNode extends CopperError {
    constructor(error: string) {
        super(error, 'no matching node', StatusCodes.NOT_FOUND);
    }
}
export class WebdriverError extends CopperError {
    constructor(error: string) {
        super(error, 'Webdriver Protocol Error', StatusCodes.BAD_REQUEST);
    }
}

export const registerErrorHandler: FastifyPluginCallback = (app, opts, done) => {
    app.setErrorHandler(async function (error, request, reply) {
        if (error instanceof CopperError) {
            reply
                .code(error.statusCode)
                .serializer((a: string) => a)
                .header('content-type', 'application/json; charset=utf-8')
                .send(JSON.stringify(error));
        }
        logger.error('Request Error', error.message, error.stack);
        reply.send(500);
    });
    done();
};
