const mainThreadId = 0;
let threadIdCounter = 1;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function yieldThread(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

function getThreadId(): number {
  return mainThreadId;
}

const Thread = {
  sleep,
  yield: yieldThread,
  id: getThreadId,
  spawn: (
    functionToRun: (transmit: { send: (data: unknown) => void }) => void,
  ) => {
    const { port1: messagePort1, port2: messagePort2 } = new MessageChannel();
    const { port1: completionPort1, port2: completionPort2 } =
      new MessageChannel();
    const workerThreadId = threadIdCounter++;

    const functionString = functionToRun.toString();
    const workerCode = /*JS*/ `
        const Thread = {
            sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
            yield: () => new Promise((resolve) => queueMicrotask(resolve)),
            id: () => ${workerThreadId},
        };

        globalThis.Thread = Thread;

        self.onmessage = async (event) => {
            const { port, completionPort } = event.data;
            port.start();
            completionPort.start();
            const transmit = {
                send: (data) => port.postMessage(data),
            };

            const userFunction = ${functionString};

            try {
                const result = userFunction(transmit);
                if (result && typeof result.then === 'function') {
                    await result;
                }
                completionPort.postMessage({ type: '__thread_complete__', code: 0 });
            } catch (error) {
                port.postMessage({ error: error.message, stack: error.stack });
                completionPort.postMessage({ type: '__thread_complete__', code: 1, error: error.message });
            }
        };
        `;

    const blob = new Blob([workerCode], { type: "application/javascript" });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl, { type: "module" });

    worker.postMessage(
      { port: messagePort2, completionPort: completionPort2 },
      [
        messagePort2,
        completionPort2,
      ],
    );

    let interrupted = false;
    let completed = false;
    let completionCode = 0;
    let completionError: Error | null = null;
    let completionResolve: ((code: number) => void) | null = null;
    let completionReject: ((error: Error) => void) | null = null;
    let timeoutId: number | undefined = undefined;

    const cleanup = () => {
      completionPort1.close();
      URL.revokeObjectURL(workerUrl);
    };

    const errorHandler = (event: ErrorEvent) => {
      if (!completed) {
        completed = true;
        worker.removeEventListener("error", errorHandler);
        completionPort1.removeEventListener("message", completionHandler);
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        completionError = new Error(`Worker error: ${event.message}`);
        worker.terminate();
        cleanup();
        if (completionReject) {
          completionReject(completionError);
        }
      }
    };
    worker.addEventListener("error", errorHandler);

    const completionHandler = (event: MessageEvent) => {
      const data = event.data;
      if (data && data.type === "__thread_complete__" && !completed) {
        completed = true;
        worker.removeEventListener("error", errorHandler);
        completionPort1.removeEventListener("message", completionHandler);
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        if (data.error) {
          completionError = new Error(`Thread error: ${data.error}`);
          cleanup();
          if (completionReject) {
            completionReject(completionError);
          }
        } else {
          completionCode = data.code || 0;
          cleanup();
          if (completionResolve) {
            completionResolve(completionCode);
          }
        }
      }
    };
    completionPort1.addEventListener("message", completionHandler);
    completionPort1.start();

    return {
      rx: {
        onMessage: (callback: (message: unknown) => void) => {
          messagePort1.onmessage = (event) => callback(event.data);
          messagePort1.start();
        },
        recv: () =>
          new Promise((resolve) => {
            const handler = (event: MessageEvent) => {
              messagePort1.removeEventListener("message", handler);
              resolve(event.data);
            };
            messagePort1.addEventListener("message", handler);
            messagePort1.start();
          }),
      },
      join: (timeout: number) => {
        return new Promise((resolve, reject) => {
          if (interrupted) {
            resolve(1);
            return;
          }

          if (completed) {
            if (completionError) {
              reject(completionError);
            } else {
              resolve(completionCode);
            }
            return;
          }

          completionResolve = resolve;
          completionReject = reject;

          if (timeout !== undefined) {
            timeoutId = setTimeout(() => {
              if (!completed) {
                completed = true;
                worker.removeEventListener("error", errorHandler);
                completionPort1.removeEventListener(
                  "message",
                  completionHandler,
                );
                worker.terminate();
                cleanup();
                const timeoutError = new Error(
                  `Thread join timed out after ${timeout}ms`,
                );
                completionError = timeoutError;
                reject(timeoutError);
              }
            }, timeout);
          }
        });
      },
      interrupt: () => {
        interrupted = true;
        completed = true;
        worker.removeEventListener("error", errorHandler);
        completionPort1.removeEventListener("message", completionHandler);
        worker.terminate();
        cleanup();
      },
      id: () => workerThreadId,
    };
  },
};

export { Thread };
