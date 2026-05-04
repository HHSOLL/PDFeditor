import { spawn } from "node:child_process";

const result = await runProcess("qpdf", ["--version"]);
if (!/qpdf version/i.test(result.stdout)) {
  throw new Error(`qpdf did not report a version:\n${result.stdout}${result.stderr}`);
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const output = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (code !== 0) {
        reject(new Error(`${command} exited ${code}\n${output.stderr}`));
        return;
      }
      resolve(output);
    });
  });
}
