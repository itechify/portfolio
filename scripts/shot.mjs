// Screenshots the running dev server at Street View and at each Station.
// Usage: node scripts/shot.mjs [baseUrl]   (default http://localhost:5173)
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:5173";
const out = "blender/renders/web";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
	args: [
		"--use-gl=angle",
		"--use-angle=swiftshader",
		"--enable-unsafe-swiftshader",
	],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(base);
await page
	.getByRole("button", { name: "Open the shop" })
	.click({ timeout: 60_000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/street.png` });

for (const label of ["About", "Projects", "Resume", "Contact", "Credits"]) {
	await page.getByRole("button", { name: label, exact: true }).click();
	await page.waitForTimeout(1800);
	await page.screenshot({ path: `${out}/${label.toLowerCase()}.png` });
}

console.log("errors:", errors.length ? errors : "none");
await browser.close();
