import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import open from "open";

const backendEntry = resolve(process.cwd(), "app/backend/dist/server.js");
const address = "http://127.0.0.1:3344";

if (!existsSync(backendEntry)) {
  console.error("Backend build not found. Run `npm run build` first.");
  process.exit(1);
}

try {
  const response = await fetch(`${address}/api/health`);
  if (response.ok) {
    console.log(`Dota Local Analytics is already running at ${address}`);
    if ((process.env.OPEN_BROWSER ?? "true") === "true") {
      try {
        await open(address);
      } catch (error) {
        console.warn(`App is running, but opening the browser failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    process.exit(0);
  }
} catch {
  // No healthy local server is active; continue with normal startup.
}

const child = spawn(process.execPath, [backendEntry], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    OPEN_BROWSER: process.env.OPEN_BROWSER ?? "true"
  }
});

const teardown = () => {
  if (!child.killed) child.kill();
};

process.on("SIGINT", teardown);
process.on("SIGTERM", teardown);
process.on("exit", teardown);
