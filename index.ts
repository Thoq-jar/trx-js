/**
 * TRX.js - Java Like Threads for TypeScript
 *
 * An abstraction over TypeScript Workers that provides Java-like threading
 * with Rust-like message passing. This module allows you to spawn worker threads
 * and communicate with them using a simple message passing API.
 *
 * @module
 */

const mainThreadId = 0;
let threadIdCounter = 1;

/**
 * Sleeps for the specified number of milliseconds.
 * @param milliseconds - The number of milliseconds to sleep
 * @returns A promise that resolves after the specified time
 */
function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Yields control to allow other tasks to run.
 * Uses queueMicrotask to yield execution to other pending tasks.
 * @returns A promise that resolves on the next microtask
 */
function yieldThread(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

/**
 * Gets the current thread ID.
 * @returns The thread ID (0 for main thread)
 */
function getThreadId(): number {
  return mainThreadId;
}

/**
 * Thread management API for creating and managing worker threads.
 * Provides Java-like threading with Rust-like message passing.
 */
const Thread = {
  /**
   * Sleeps for the specified number of milliseconds.
   * @param milliseconds - The number of milliseconds to sleep
   * @returns A promise that resolves after the specified time
   */
  sleep,
  /**
   * Yields control to allow other tasks to run.
   * @returns A promise that resolves on the next microtask
   */
  yield: yieldThread,
  /**
   * Gets the current thread ID.
   * @returns The thread ID (0 for main thread)
   */
  id: getThreadId,
  /**
   * Spawns a new worker thread and executes the provided function in it.
   * @param functionToRun - The function to execute in the worker thread. Receives a transmit object with a `send` method for sending messages.
   * @returns A thread handle with methods to interact with the spawned thread:
   *   - `rx`: Receiver object with `onMessage` and `recv` methods for receiving messages
   *   - `join`: Waits for the thread to complete with an optional timeout
   *   - `interrupt`: Terminates the thread
   *   - `id`: Returns the thread ID
   * @example
   * ```ts
   * const handle = Thread.spawn((tx) => {
   *   tx.send({ result: "Hello from worker!" });
   * });
   * const message = await handle.rx.recv();
   * await handle.join(5000);
   * ```
   */
  spawn: (
    functionToRun: (transmit: { send: (data: unknown) => void }) => void,
  ): {
    rx: {
      onMessage: (callback: (message: unknown) => void) => void;
      recv: () => Promise<unknown>;
    };
    join: (timeout: number) => Promise<number>;
    interrupt: () => void;
    id: () => number;
  } => {
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
      /**
       * Receiver object for receiving messages from the worker thread.
       */
      rx: {
        /**
         * Sets up a callback to handle all messages from the worker thread.
         * @param callback - Function to call when a message is received
         */
        onMessage: (callback: (message: unknown) => void) => {
          messagePort1.onmessage = (event) => callback(event.data);
          messagePort1.start();
        },
        /**
         * Receives a single message from the worker thread.
         * @returns A promise that resolves with the next message from the worker
         */
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
      /**
       * Waits for the thread to complete execution.
       * @param timeout - Maximum time to wait in milliseconds. If undefined, waits indefinitely.
       * @returns A promise that resolves with the exit code (0 for success) or rejects with an error
       */
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
      /**
       * Interrupts and terminates the worker thread immediately.
       * Cleans up resources and stops message handling.
       */
      interrupt: () => {
        interrupted = true;
        completed = true;
        worker.removeEventListener("error", errorHandler);
        completionPort1.removeEventListener("message", completionHandler);
        worker.terminate();
        cleanup();
      },
      /**
       * Gets the ID of this worker thread.
       * @returns The unique thread ID assigned to this worker
       */
      id: () => workerThreadId,
    };
  },
};

/**
 * Main Thread API for spawning and managing worker threads.
 *
 * @example
 * ```ts
 * import { Thread } from "@thoq/trx";
 *
 * // Spawn a worker thread
 * const handle = Thread.spawn((tx) => {
 *   console.log(`Worker thread ID: ${Thread.id()}`);
 *   tx.send({ result: "Hello from worker!" });
 * });
 *
 * // Receive a message
 * const message = await handle.rx.recv();
 * console.log("Received:", message);
 *
 * // Wait for thread to complete
 * await handle.join(5000);
 * ```
 */
export { Thread };
