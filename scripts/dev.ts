import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import open from "open";

const root = process.cwd();

const backend = spawn("npm", ["run", "dev", "-w", "@dota/backend"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    NODE_ENV: "development",
    OPEN_BROWSER: "false"
  }
});

const frontend = spawn("npm", ["run", "dev", "-w", "@dota/frontend"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    NODE_ENV: "development"
  }
});

const teardown = () => {
  backend.kill();
  frontend.kill();
};

process.on("SIGINT", teardown);
process.on("SIGTERM", teardown);
process.on("exit", teardown);

async function boot() {
  await delay(3000);
  await open("http://localhost:5173");
}

boot().catch((error) => {
  console.error("Failed to open browser", error);
});
