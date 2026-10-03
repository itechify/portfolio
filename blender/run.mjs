// Runs the Blender build headless. Usage: pnpm model:build [-- --no-render]
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
	process.env.BLENDER,
	"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe",
	"blender",
].filter(Boolean);
const blender = candidates.find((c) => c === "blender" || existsSync(c));
const extra = process.argv.slice(2);
const result = spawnSync(
	blender,
	["-b", "--python", join(here, "build.py"), "--", ...extra],
	{ stdio: "inherit" },
);
process.exit(result.status ?? 1);
