import { expect } from "@playwright/test";

/** Matching baked-lighting comparisons through the real Station controls. */
export async function reviewLighting(page, out) {
	await page.emulateMedia({ reducedMotion: "reduce" });
	for (const [layout, width, height] of [
		["desktop", 1280, 800],
		["narrow", 390, 844],
	]) {
		await page.setViewportSize({ width, height });
		for (const tier of ["Full", "Balanced", "Light"]) {
			await page
				.getByRole("button", { name: "Street View", exact: true })
				.click();
			await page.getByRole("button", { name: "Quality settings" }).click();
			await page.getByRole("radio", { name: tier, exact: true }).check();
			await page.keyboard.press("Escape");
			for (const station of [
				"Street View",
				"About",
				"Projects",
				"Resume",
				"Contact",
				"Credits",
			]) {
				await page.getByRole("button", { name: station, exact: true }).click();
				await expect(
					page.getByRole("button", { name: station, exact: true }),
				).toHaveAttribute("aria-current", "location");
				await page.waitForTimeout(700);
				await page.screenshot({
					path: `${out}/${layout}-${tier.toLowerCase()}-${station.toLowerCase().replaceAll(" ", "-")}.png`,
				});
			}
		}
	}
	console.log(
		"Lighting: all Station Menu Sections captured on desktop and narrow viewports in Full, Balanced and Light",
	);
}
