import { Thread } from "./index.ts";

async function main(): Promise<void> {
  console.log(`Main thread ID: ${Thread.id()}`);
  console.log("Main thread: Starting worker threads...");

  const handle1 = Thread.spawn(async (tx) => {
    console.log(`Worker thread ID: ${Thread.id()}`);

    for (let i = 0; i < 5; i++) {
      console.log(`Worker 1: Step ${i + 1}`);
      await Thread.sleep(500);
    }

    tx.send({ result: "Worker 1 completed", status: "Done!" });
  });

  const handle2 = Thread.spawn(async (tx) => {
    console.log(`Worker thread ID: ${Thread.id()}`);

    for (let i = 0; i < 3; i++) {
      console.log(`Worker 2: Processing ${i + 1}`);
      await Thread.yield();
      await Thread.sleep(300);
    }

    tx.send({ result: "Worker 2 completed", status: "Done!" });
  });

  const handle3 = Thread.spawn(async (tx) => {
    console.log(`Worker thread ID: ${Thread.id()}`);

    let sum = 0;
    for (let i = 0; i < 1e7; i++) {
      sum += i;
      if (i % 1e6 === 0) {
        await Thread.yield();
      }
    }

    tx.send({ result: sum, status: "Computation done!" });
  });

  console.log("Waiting for threads to complete...");

  try {
    await Promise.all([
      handle1.join(5000),
      handle2.join(5000),
      handle3.join(10000),
    ]);
    console.log("All threads completed successfully!");
  } catch (error) {
    console.error("Error waiting for threads:", (error as Error).message);
  }

  const msg1 = await handle1.rx.recv();
  console.log("Main thread received from thread 1:", msg1);

  const msg2 = await handle2.rx.recv();
  console.log("Main thread received from thread 2:", msg2);

  const msg3 = await handle3.rx.recv();
  console.log("Main thread received from thread 3:", msg3);

  console.log("All done!");
  Deno.exit(0);
}

main();
