import assert from "node:assert/strict";

/** Visual QA through the same exported controllers and renderer as the app. */
export async function reviewCustomers(page, out) {
	await page.evaluate(async () => {
		const resource = performance
			.getEntriesByType("resource")
			.find((r) => r.name.includes("/@react-three_fiber"));
		const { _roots } = await import(resource.name);
		const state = _roots.get(document.querySelector("canvas")).store.getState();
		state.setFrameloop("never");
		const { createCharacterMotion } = await import(
			"/src/scene/characterMotion.ts"
		);
		const { createCustomerVisits } = await import(
			"/src/scene/customerVisits.ts"
		);
		const characters = createCharacterMotion(state.scene);
		const visits = createCustomerVisits(state.scene, () => 0);
		const review = {
			state,
			visits,
			time: 0,
			step(seconds, enabled = true, street = true, quality = "full") {
				let cats;
				for (let i = 0; i < Math.max(1, seconds * 60); i++) {
					const delta = seconds ? 1 / 60 : 0;
					cats = characters(delta, enabled, street, visits.needsSidewalk);
					visits.update(delta, enabled, street, cats, quality);
					review.time += delta;
				}
				[...cats, visits.shadow].forEach((animal, i) => {
					const shadow = state.scene.getObjectByName(
						i < 2
							? `prop_cat_contact_shadow_${i + 1}`
							: "prop_customer_contact_shadow",
					);
					shadow.position.set(
						animal.position.x,
						animal.shadowHeight + 0.003,
						animal.position.z,
					);
					shadow.material.opacity = animal.shadowOpacity;
				});
				return { ...visits.state };
			},
			render(detail = true) {
				const customer = visits.shadow.position;
				if (detail) {
					state.camera.position.set(
						customer.x + (visits.state.phase === "leave" ? -2.5 : 2.5),
						2.15,
						4.3,
					);
					state.camera.lookAt(customer.x, 1.0, 1.6);
				} else {
					state.camera.position.set(0, 4.2, 14);
					state.camera.lookAt(0, 3, 0);
				}
				state.camera.updateMatrixWorld();
				for (const sub of state.internal.subscribers)
					if (sub.priority > 0) sub.ref.current(state, 0);
			},
		};
		window.customerReview = review;
	});
	for (const seconds of [
		8, 12.3, 14.9, 16.3, 18.4, 19.9, 22.5, 24.5, 26.5, 31, 51, 62,
	]) {
		const state = await page.evaluate((seconds) => {
			const review = window.customerReview;
			const state = review.step(Math.max(0, seconds - review.time));
			review.render();
			return state;
		}, seconds);
		await page.screenshot({ path: `${out}/customer-${seconds}.png` });
		console.log("Customer pose", seconds, state.phase, state.variant);
	}
	await page.evaluate(() => {
		const review = window.customerReview;
		for (let i = 0; i < 180 * 60; i++) {
			const state = review.step(1 / 60);
			if (state.variant === 1 && state.phase === "approach" && state.x > -4.5) {
				review.render();
				return;
			}
		}
		throw new Error("Second regular did not arrive");
	});
	await page.screenshot({ path: `${out}/customer-second-arrival.png` });
	await page.evaluate(() => {
		const review = window.customerReview;
		for (let i = 0; i < 180 * 60; i++) {
			const state = review.step(1 / 60);
			if (state.variant === 1 && state.phase === "enjoy" && state.time > 1) {
				review.render();
				return;
			}
		}
		throw new Error("Second regular did not receive service");
	});
	await page.screenshot({ path: `${out}/customer-second-service.png` });
	await page.evaluate(() => {
		const { state } = window.customerReview;
		state.camera.position.set(-0.3, 2.1, 2.5);
		state.camera.lookAt(-0.66, 1.03, 1.25);
		state.camera.updateMatrixWorld();
		for (const sub of state.internal.subscribers)
			if (sub.priority > 0) sub.ref.current(state, 0);
	});
	await page.screenshot({ path: `${out}/counter-cookies.png` });
	await page.getByRole("button", { name: "Quality settings" }).click();
	await page.getByRole("radio", { name: "Light", exact: true }).check();
	await page.keyboard.press("Escape");
	await page.waitForTimeout(500);
	await page.evaluate(() => {
		window.customerReview.step(0, true, true, "light");
		window.customerReview.render();
	});
	await page.screenshot({ path: `${out}/customer-light.png` });
	await page.getByRole("button", { name: "Quality settings" }).click();
	await page.getByRole("radio", { name: "Full", exact: true }).check();
	await page.keyboard.press("Escape");
	await page.waitForTimeout(500);
	await page.evaluate(() => {
		window.customerReview.step(0, false);
		window.customerReview.render();
	});
	await page.screenshot({ path: `${out}/customer-reduced-detail.png` });
	for (const [label, width, height] of [
		["street", 1280, 800],
		["phone", 390, 844],
	]) {
		await page.setViewportSize({ width, height });
		await page.waitForTimeout(500);
		await page.evaluate(() => window.customerReview.render(false));
		await page.screenshot({ path: `${out}/customer-${label}.png` });
	}
	// Exercise actual Station controls with a visit in progress.
	await page.evaluate(() => window.customerReview.step(16));
	await page.getByRole("button", { name: "About", exact: true }).click();
	const settled = await page.evaluate(() =>
		window.customerReview.step(100, true, false),
	);
	assert.equal(settled.phase, "quiet");
	const quiet = await page.evaluate(() => window.customerReview.step(10));
	assert.equal(quiet.phase, "quiet");
	console.log(
		"Customer review: both regulars, service poses, reduced motion, mobile and Station completion passed",
	);
}
