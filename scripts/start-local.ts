import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const backendEntry = resolve(process.cwd(), "app/backend/dist/server.js");

if (!existsSync(backendEntry)) {
  console.error("Backend build not found. Run `npm run build` first.");
  process.exit(1);
}

const child = spawn("node", [backendEntry], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    NODE_ENV: "production",
    OPEN_BROWSER: process.env.OPEN_BROWSER ?? "true"
  }
});

const teardown = () => child.kill();
process.on("SIGINT", teardown);
process.on("SIGTERM", teardown);
process.on("exit", teardown);
