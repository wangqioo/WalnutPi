import { spawn } from "node:child_process";
import process from "node:process";

const args = process.argv.slice(2);

const command = process.platform === "win32" ? "pwsh" : "bash";
const commandArgs = process.platform === "win32"
  ? ["./scripts/build-lvgl-app.ps1", ...args]
  : ["./scripts/build-lvgl-app.sh", ...args];

const child = spawn(command, commandArgs, {
  stdio: "inherit",
  shell: false,
});

child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`build interrupted by ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code || 0;
});
