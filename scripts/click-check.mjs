// Verifies that clicking Hotspot detail in the scene (not the menu) opens the
// right Station. Usage: node scripts/click-check.mjs [baseUrl]
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

// Pixel positions from the 1280x800 Street View screenshot.
const targets = [
	{ name: "cow snout (About)", x: 470, y: 320, expect: "About" },
	{ name: "sign letters (Street View)", x: 600, y: 405, expect: null },
	{ name: "kiosk screen (Resume)", x: 300, y: 560, expect: "Resume" },
	{ name: "machine screen (Projects)", x: 915, y: 545, expect: "Projects" },
];
let failed = 0;
for (const t of targets) {
	await page.mouse.move(t.x, t.y);
	await page.waitForTimeout(300);
	const cursor = await page.evaluate(() => document.body.style.cursor);
	await page.mouse.click(t.x, t.y);
	await page.waitForTimeout(1500);
	const active = await page.evaluate(
		() =>
			document.querySelector(".station-menu button[aria-current]")
				?.textContent ?? null,
	);
	const ok = t.expect ? active === t.expect : active === "Street View";
	if (!ok) failed++;
	console.log(
		`${ok ? "ok  " : "FAIL"} ${t.name}: cursor=${cursor || "default"} active=${active}`,
	);
	// Return to Street View and let the camera settle so pixel positions hold.
	await page.getByRole("button", { name: "Street View", exact: true }).click();
	await page.waitForTimeout(2500);
}
await browser.close();
process.exit(failed ? 1 : 0);
