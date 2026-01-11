# TRX.js

Java Like Threads for TypeScript with Rust-like message passing.

TRX is an abstraction over TypeScript Workers and tries to resemble Rust and
Java threading.

## Usage

### Basic Example

```ts
import { Thread } from "@thoq/trx";

// Spawn a thread
const handle = Thread.spawn((tx) => {
  console.log(`Worker thread ID: ${Thread.id()}`);

  // do some work
  for (let i = 0; i < 5; i++) {
    console.log(`Step ${i + 1}`);
    await Thread.sleep(500);
  }

  // semd message back to main thread
  tx.send({ result: "Worker completed!", status: "Done!" });
});

// receive message from thread
const message = await handle.rx.recv();
console.log("Received:", message);

// wait for thread to complete (timeout)
await handle.join(5000);
```

### Multiple Threads

```ts
import { Thread } from "@thoq/trx";

const handles = [
  Thread.spawn((tx) => {
    // thread 1
    tx.send({ worker: 1, result: "Done" });
  }),
  Thread.spawn((tx) => {
    // thread 2
    tx.send({ worker: 2, result: "Done" });
  }),
];

// wait for all threads to complete
await Promise.all([
  handles[0].join(5000),
  handles[1].join(5000),
]);

// receive messages from all threads
const msg1 = await handles[0].rx.recv();
const msg2 = await handles[1].rx.recv();
```

### Using onMessage for Continuous Communication

```ts
import { Thread } from "@thoq/trx";

const handle = Thread.spawn((tx) => {
  // sned multiple messages
  tx.send({ type: "progress", value: 25 });
  tx.send({ type: "progress", value: 50 });
  tx.send({ type: "progress", value: 75 });
  tx.send({ type: "complete", value: 100 });
});

// handle all messages
handle.rx.onMessage((message) => {
  console.log("Received:", message);
});
```

See the [demo](demo.ts) for more examples.
