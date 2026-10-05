// Verify the real TV materials through pointer input, including the animated
// material swap. Run against Vite: node scripts/check-tv-hover.mjs [baseUrl]
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";

const browser = await chromium.launch({
	args: [
		"--use-gl=angle",
		"--use-angle=swiftshader",
		"--enable-unsafe-swiftshader",
	],
});
const out = "blender/renders/web";
mkdirSync(out, { recursive: true });
try {
	for (const reducedMotion of ["reduce", "no-preference"]) {
		const page = await browser.newPage({
			viewport: { width: 1280, height: 800 },
			reducedMotion,
		});
		await page.goto(process.argv[2] ?? "http://127.0.0.1:5173/");
		await page.getByRole("button", { name: "Open the shop" }).click();
		await page.waitForTimeout(2500);
		const screen = page.getByRole("button", {
			name: "Watch BetaByJ Shorts on the TV",
			exact: true,
		});
		const bounds = await screen.boundingBox();
		assert.ok(bounds);
		const materials = () =>
			page.evaluate(async () => {
				// Read the existing Canvas store; no production debug hooks or mocks.
				const { _roots } = await import(
					"/node_modules/.vite/deps/@react-three_fiber.js"
				);
				const { scene } = _roots
					.get(document.querySelector("canvas"))
					.store.getState();
				const tv = scene.getObjectByName("hotspot_shorts_tv");
				let poster;
				tv.traverse((mesh) => {
					if (mesh.material?.name === "tv_bouldering_poster")
						poster = mesh.material;
				});
				return {
					frame: tv.material.color.r,
					screen: poster.emissiveIntensity,
					animated:
						poster.emissiveMap.image.src?.includes("tv-bouldering-loop") ??
						false,
				};
			});
		await expect
			.poll(async () => (await materials()).animated)
			.toBe(reducedMotion === "no-preference");
		await page.mouse.move(20, 20);
		await page.waitForTimeout(200);
		const idle = await materials();
		await page.screenshot({
			path: `${out}/tv-hover-${reducedMotion}-idle.png`,
		});
		for (const target of ["frame", "screen"]) {
			if (target === "frame")
				await page.mouse.move(bounds.x - 5, bounds.y + bounds.height / 2);
			else await screen.hover();
			await page.waitForTimeout(250);
			const hovered = await materials();
			console.log(reducedMotion, target, { idle, hovered });
			assert.ok(
				hovered.frame > idle.frame + 0.1,
				`${target} hover must brighten the TV frame`,
			);
			assert.ok(
				hovered.screen > idle.screen + 0.1,
				`${target} hover must brighten the TV screen`,
			);
		}
		await page.screenshot({
			path: `${out}/tv-hover-${reducedMotion}-active.png`,
		});
		await page.mouse.move(20, 20);
		await page.waitForTimeout(250);
		assert.deepEqual(
			await materials(),
			idle,
			"pointer exit must restore both materials",
		);
		await expect(page.locator(".hint")).toHaveCount(0);
		await page.close();
	}
} finally {
	await browser.close();
}
