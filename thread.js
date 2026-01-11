const { Worker, MessageChannel, threadId } = require("node:worker_threads");

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @returns {Promise<void>}
 */
function yieldThread() {
    return new Promise((resolve) => setImmediate(resolve));
}

/**
 * @returns {number}
 */
function getThreadId() {
    try {
        return require("node:worker_threads").threadId;
    } catch {
        return 0;
    }
}

const Thread = {
    /**
     * @param {number} ms
     * @returns {Promise<void>}
     */
    sleep,
    /**
     * @returns {Promise<void>}
     */
    yield: yieldThread,
    /**
     * @returns {number}
     */
    id: getThreadId,
    /**
     * @param {(tx: { send: (data: any) => void }) => void} fn
     * @returns {{ rx: { onMessage: (callback: (msg: any) => void) => void, recv: () => Promise<any> }, join: (timeout?: number) => Promise<number>, interrupt: () => Promise<void>, id: () => number }}
     */
    spawn: (fn) => {
        const { port1, port2 } = new MessageChannel();

        const workerCode = /*JS*/ `
        const { parentPort, threadId } = require('node:worker_threads');
      
        const Thread = {
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            yield: () => new Promise((resolve) => setImmediate(resolve)),
            id: () => threadId,
        };
        
        globalThis.Thread = Thread;

        parentPort.on("message", async ({ port }) => {
            const tx = {
                send: (data) => port.postMessage(data),
            };

            const userFn = (${fn.toString()});
            
            try {
                const result = userFn(tx);
                if (result && typeof result.then === 'function') {
                    await result;
                }
            } catch (error) {
                port.postMessage({ error: error.message, stack: error.stack });
            }
        });
        `;

        const worker = new Worker(workerCode, { eval: true });
        const workerThreadId = worker.threadId;

        worker.postMessage({ port: port2 }, [port2]);

        let interrupted = false;

        return {
            rx: {
                /**
                 * @param {(msg: any) => void} callback
                 */
                onMessage: (callback) => port1.on("message", callback),
                /**
                 * @returns {Promise<any>}
                 */
                recv: () =>
                    new Promise((resolve) => port1.once("message", resolve)),
            },
            /**
             * @param {number} [timeout]
             * @returns {Promise<number>}
             */
            join: (timeout) => {
                return new Promise((resolve, reject) => {
                    if (interrupted) {
                        resolve(1);
                        return;
                    }

                    const exitCode = worker.exitCode;
                    if (exitCode !== null) {
                        resolve(exitCode);
                        return;
                    }

                    const exitHandler = (exitCode) => {
                        if (timeoutId) clearTimeout(timeoutId);
                        resolve(exitCode);
                    };

                    worker.once("exit", exitHandler);

                    let timeoutId;
                    if (timeout !== undefined) {
                        timeoutId = setTimeout(() => {
                            worker.removeListener("exit", exitHandler);
                            reject(
                                new Error(
                                    `Thread join timed out after ${timeout}ms`,
                                ),
                            );
                        }, timeout);
                    }
                });
            },
            /**
             * @returns {Promise<void>}
             */
            interrupt: async () => {
                interrupted = true;
                await worker.terminate();
            },
            /**
             * @returns {number}
             */
            id: () => workerThreadId,
        };
    },
};

module.exports = { Thread };
