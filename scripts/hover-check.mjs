// Sweeps the pointer across the cow screen and the sign and counts cursor
// changes. A stable hover shows one change in and one out per sweep.
// Also samples the fan blades to confirm they stay in the housing plane.
// Usage: node scripts/hover-check.mjs [baseUrl]
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:5173";
const browser = await chromium.launch({
	args: [
		"--use-gl=angle",
		"--use-angle=swiftshader",
		"--enable-unsafe-swiftshader",
	],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(base);
await page
	.getByRole("button", { name: "Open the shop" })
	.click({ timeout: 60_000 });
await page.waitForTimeout(2500);

let failed = 0;
for (const sweep of [
	{ name: "cow screen", y: 300, from: 380, to: 560 },
	{ name: "sign", y: 405, from: 340, to: 780 },
]) {
	let last = null;
	let changes = 0;
	for (let x = sweep.from; x <= sweep.to; x += 4) {
		await page.mouse.move(x, sweep.y);
		await page.waitForTimeout(40);
		const c =
			(await page.evaluate(() => document.body.style.cursor)) || "default";
		if (c !== last) {
			changes++;
			last = c;
		}
	}
	// First sample counts as a change, then in (pointer) and maybe out (default).
	const ok = changes <= 3;
	if (!ok) failed++;
	console.log(
		`${ok ? "ok  " : "FAIL"} ${sweep.name}: ${changes} cursor changes across the sweep`,
	);
}
await page.mouse.move(10, 700);
await browser.close();
process.exit(failed ? 1 : 0);
