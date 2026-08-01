export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { initializeExistingRuntime } = await import("./server/runtime.ts");
  initializeExistingRuntime();
}
