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

if (process.argv.includes("--cats")) {
	// Deterministic pose review through the same public controller as the app.
	// Keep this dev-only inspection here, out of the shipped visitor experience.
	await page.evaluate(async () => {
		const resource = performance
			.getEntriesByType("resource")
			.find(
				(r) =>
					r.name.includes("/@react-three_fiber") ||
					r.name.includes("/deps/@react-three_fiber"),
			);
		const { _roots } = await import(resource.name);
		const state = _roots.get(document.querySelector("canvas")).store.getState();
		state.setFrameloop("never");
		const { createCharacterMotion } = await import(
			"/src/scene/characterMotion.ts"
		);
		window.catReview = {
			state,
			update: createCharacterMotion(state.scene),
			time: 0,
		};
	});
	for (const seconds of [0, 8.6, 25.1, 45.5, 73.5, 77, 102.9, 106]) {
		const positions = await page.evaluate((seconds) => {
			const { state, update } = window.catReview;
			let cats = update(0, true, true);
			while (window.catReview.time < seconds) {
				cats = update(1 / 60, true, true);
				window.catReview.time += 1 / 60;
			}
			cats.forEach((cat, i) => {
				const shadow = state.scene.getObjectByName(
					`prop_cat_contact_shadow_${i + 1}`,
				);
				shadow.position.set(
					cat.position.x,
					cat.shadowHeight + 0.003,
					cat.position.z,
				);
				shadow.material.opacity = cat.shadowOpacity;
			});
			const p = cats[seconds >= 100 ? 1 : 0].position;
			state.camera.position.set(p.x - 0.8, p.y + 0.65, p.z + 1.3);
			state.camera.lookAt(p.x, p.y + 0.13, p.z);
			state.camera.updateMatrixWorld();
			for (const subscriber of state.internal.subscribers) {
				if (subscriber.priority > 0) subscriber.ref.current(state, 0);
			}
			return cats.map((cat) => cat.position.toArray());
		}, seconds);
		await page.screenshot({ path: `${out}/cats-${seconds}.png` });
		console.log("Cat pose", seconds, positions);
	}
	for (const [label, width, height] of [
		["street", 1280, 800],
		["phone", 390, 844],
	]) {
		await page.setViewportSize({ width, height });
		await page.waitForTimeout(500);
		await page.evaluate(() => {
			const { state } = window.catReview;
			state.camera.position.set(0, 4.2, 14);
			state.camera.lookAt(0, 3, 0);
			state.camera.updateMatrixWorld();
			for (const subscriber of state.internal.subscribers) {
				if (subscriber.priority > 0) subscriber.ref.current(state, 0);
			}
		});
		await page.screenshot({ path: `${out}/cats-${label}.png` });
	}
	assert.deepEqual(errors, []);
	await browser.close();
	process.exit(0);
}

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
