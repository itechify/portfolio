import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, expect } from "@playwright/test";

let browser;
before(async () => {
	browser = await chromium.launch({
		args: [
			"--use-gl=angle",
			"--use-angle=swiftshader",
			"--enable-unsafe-swiftshader",
		],
	});
});
after(async () => browser?.close());

async function visit(t, options = {}) {
	const page = await browser.newPage({
		viewport: { width: 1280, height: 800 },
		...options,
	});
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	t.after(async () => {
		await page.close();
		assert.deepEqual(errors, []);
	});
	await page.goto(process.env.ABOUT_TEST_URL ?? "http://127.0.0.1:5173");
	await page
		.getByRole("button", { name: "Open the shop" })
		.click({ timeout: 60_000 });
	return page;
}

test("About can be read and closed using only the keyboard", async (t) => {
	const page = await visit(t);
	const about = page.getByRole("button", { name: "About", exact: true });
	await about.focus();
	await page.keyboard.press("Enter");
	await expect(
		page.getByRole("heading", { name: "About", exact: true }),
	).toBeFocused();
	await expect(
		page.getByText("Hi, I'm Jeffrey", { exact: false }),
	).toBeVisible();
	await page.keyboard.press("Tab");
	await expect(
		page.getByRole("button", { name: "Back to the street" }),
	).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(about).toBeFocused();
	await expect(
		page.getByRole("button", { name: "Street View", exact: true }),
	).toHaveAttribute("aria-current", "location");
	await expect(
		page.getByRole("heading", { name: "About", exact: true }),
	).toHaveCount(0);
});

test("About is framed on its screen on desktop and stays readable as a phone panel", async (t) => {
	const page = await visit(t, { reducedMotion: "reduce" });
	await page.getByRole("button", { name: "About", exact: true }).click();
	const section = page.locator("#about");
	await expect
		.poll(async () => {
			const box = await section.boundingBox();
			return Math.abs(box.x + box.width / 2 - 640);
		})
		.toBeLessThan(20);
	const desktop = await section.boundingBox();
	assert.ok(
		desktop.width > 420 && desktop.height > 360,
		"the screen is large enough to read",
	);
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(
		page.getByRole("heading", { name: "About", exact: true }),
	).toBeVisible();
	await expect(
		page.getByText("Hi, I'm Jeffrey", { exact: false }),
	).toBeVisible();
	await expect
		.poll(
			async () => {
				const phone = await section.boundingBox();
				return phone.x >= 0 && phone.x + phone.width <= 390;
			},
			{
				message: "the panel fits the phone after the responsive layout updates",
			},
		)
		.toBe(true);
	await page.getByRole("button", { name: "Back to the street" }).click();
	await expect(
		page.getByRole("button", { name: "About", exact: true }),
	).toBeFocused();
	await expect(
		page.getByRole("button", { name: "Street View", exact: true }),
	).toHaveAttribute("aria-current", "location");
});

test("phone visitors can open and reopen About with the keyboard", async (t) => {
	const page = await visit(t, { viewport: { width: 390, height: 844 } });
	const about = page.getByRole("button", { name: "About", exact: true });
	for (let i = 0; i < 2; i++) {
		await about.focus();
		await page.keyboard.press("Enter");
		await expect(
			page.getByRole("heading", { name: "About", exact: true }),
		).toBeFocused();
		await page.keyboard.press("Tab");
		await expect(
			page.getByRole("button", { name: "Back to the street" }),
		).toBeFocused();
		const close = await page
			.getByRole("button", { name: "Back to the street" })
			.boundingBox();
		const menu = await page
			.getByRole("navigation", { name: "Stations" })
			.boundingBox();
		assert.ok(
			close.y + close.height <= menu.y,
			"the wrapped menu does not cover the close control",
		);
		await page.keyboard.press("Enter");
		await expect(about).toBeFocused();
	}
});

test("returning from the TV to About preserves focus on the TV Hotspot", async (t) => {
	const page = await visit(t, { viewport: { width: 390, height: 844 } });
	await page.route("https://www.youtube.com/iframe_api", (route) =>
		route.fulfill({ contentType: "text/javascript", body: "" }),
	);
	await page.getByRole("button", { name: "About", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "About", exact: true }),
	).toBeFocused();
	const tv = page.getByRole("button", {
		name: "Watch BetaByJ Shorts on the TV",
		exact: true,
	});
	await tv.focus();
	await page.keyboard.press("Enter");
	await page.getByRole("button", { name: "Close TV", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "About", exact: true }),
	).toBeVisible();
	await expect(tv).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("button", { name: "About", exact: true }),
	).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(
		page.getByRole("heading", { name: "About", exact: true }),
	).toBeFocused();
});
