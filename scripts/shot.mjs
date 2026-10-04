// Screenshots the running dev server at Street View and at each Station.
// Usage: node scripts/shot.mjs [baseUrl]   (default http://localhost:5173)
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";

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

if (process.argv.includes("--tv-idle")) {
	// Interior of the TV in the fixed 1280 × 800 Street View: exclude the
	// glowing bezel, fans and characters so only the climber changes pixels.
	const clip = { x: 894, y: 218, width: 65, height: 127 };
	await page.waitForTimeout(2000);
	const poses = new Map();
	for (let i = 0; i < 8; i++) {
		const png = await page.screenshot({ clip });
		poses.set(png.toString("base64"), png);
		await page.waitForTimeout(350);
	}
	assert.ok(poses.size > 1, "idle TV must visibly animate after Entry");
	[...poses.values()].forEach((png, i) => {
		writeFileSync(`${out}/tv-idle-${i}.png`, png);
	});
	console.log("Visible idle TV poses:", poses.size);
	const reduced = await browser.newPage({
		viewport: { width: 1280, height: 800 },
		reducedMotion: "reduce",
	});
	let requestedAtlas = false;
	reduced.on("request", (request) => {
		if (request.url().includes("tv-bouldering-loop")) requestedAtlas = true;
	});
	await reduced.goto(base);
	await reduced.getByRole("button", { name: "Open the shop" }).click();
	await reduced.waitForTimeout(3000);
	const still = await reduced.screenshot({ clip });
	await reduced.waitForTimeout(1500);
	assert.deepEqual(await reduced.screenshot({ clip }), still);
	assert.equal(requestedAtlas, false, "reduced motion does not load the atlas");
	console.log("Reduced motion: unchanged TV pixels; no animation download");
	await reduced.close();
}

for (const label of process.argv.includes("--tv-only")
	? []
	: ["About", "Projects", "Resume", "Contact", "Credits"]) {
	await page.getByRole("button", { name: label, exact: true }).click();
	await page.waitForTimeout(1800);
	await page.screenshot({ path: `${out}/${label.toLowerCase()}.png` });
}

await expect(page.locator(".station-menu")).not.toContainText("BetaByJ");
await expect(page.locator('script[src*="youtube.com/iframe_api"]')).toHaveCount(
	0,
);
await page.getByRole("button", { name: "About", exact: true }).click();
await page.waitForTimeout(1800);
await page
	.getByRole("button", { name: "Watch BetaByJ Shorts on the TV", exact: true })
	.focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(8000);
await page.screenshot({ path: `${out}/shorts.png` });
console.log("TV:", await page.locator(".tv-status").textContent());
console.log("TV frame:", await page.locator(".tv-surface").boundingBox());
const playerFrame = page
	.frames()
	.find((frame) => frame.url().includes("youtube.com/embed"));
if (playerFrame)
	console.log(
		"Playback:",
		await playerFrame.evaluate(() => {
			const video = document.querySelector("video");
			return video
				? {
						seconds: video.currentTime,
						paused: video.paused,
						muted: video.muted,
						readyState: video.readyState,
					}
				: "YouTube has not supplied a video element";
		}),
	);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/shorts-phone.png` });
await page.getByRole("button", { name: "Close TV", exact: true }).click();
await expect(page.locator("#about")).not.toHaveAttribute("aria-hidden", "true");
await expect(
	page.getByRole("button", {
		name: "Watch BetaByJ Shorts on the TV",
		exact: true,
	}),
).toBeFocused();
console.log(
	"TV frames after close:",
	await page.locator(".tv-player iframe").count(),
);

console.log("errors:", errors.length ? errors : "none");
await browser.close();
