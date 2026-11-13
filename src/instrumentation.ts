/** Starts the background sync worker inside the Next.js server process. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/sync/run");
    startScheduler();
  }
}
