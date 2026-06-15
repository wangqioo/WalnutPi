import { spawn } from "node:child_process";
import process from "node:process";

const args = process.argv.slice(2);
let workspaceLvgl = "";
const passthrough = [];

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--workspace-lvgl") {
    workspaceLvgl = args[index + 1] || "";
    index += 1;
  } else {
    passthrough.push(arg);
  }
}

const env = { ...process.env };
if (workspaceLvgl) env.WALNUT_SCREEN_WORKSPACE_LVGL = workspaceLvgl;

const command = process.platform === "win32" ? "pwsh" : "bash";
const commandArgs = process.platform === "win32"
  ? ["./scripts/build-lvgl-app.ps1", ...passthrough]
  : ["./scripts/build-lvgl-app.sh", ...passthrough];

const child = spawn(command, commandArgs, {
  env,
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
