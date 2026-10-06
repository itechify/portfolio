import { readFileSync, writeFileSync } from "node:fs";

/** Repeatable browser views of the baked model, independent of visit timing. */
export async function reviewModelDetails(page, out) {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.waitForTimeout(500);
	await page.evaluate(async () => {
		const resource = performance
			.getEntriesByType("resource")
			.find((entry) => entry.name.includes("/@react-three_fiber"));
		const { _roots } = await import(resource.name);
		const state = _roots.get(document.querySelector("canvas")).store.getState();
		state.setFrameloop("never");
		window.modelReview = (position, target) => {
			state.camera.position.fromArray(position);
			state.camera.lookAt(...target);
			state.camera.updateMatrixWorld();
			state.gl.info.autoReset = false;
			state.gl.info.reset();
			for (const sub of state.internal.subscribers)
				if (sub.priority > 0) sub.ref.current(state, 0);
			const result = {
				calls: state.gl.info.render.calls,
				triangles: state.gl.info.render.triangles,
				textures: state.gl.info.memory.textures,
			};
			state.gl.info.autoReset = true;
			return result;
		};
	});
	const views = [
		["street", [0, 4.2, 14], [0, 3, 0]],
		["entrance", [3.7, 2.4, 5.7], [1.25, 1.25, 1.3]],
		["counter", [-1, 1.9, 6.5], [-1.2, 1.3, 0]],
		["kiosk", [-5.8, 1.8, 3.5], [-4.2, 0.85, 0.4]],
		["machine", [4.7, 1.65, 3.4], [3.3, 0.95, 0.6]],
		["food", [-0.7, 1.85, 2.35], [-0.86, 1.02, 1.22]],
	];
	const render = (position, target) =>
		page.evaluate(
			({ position, target }) => window.modelReview(position, target),
			{ position, target },
		);
	const measurements = {};
	for (const [name, position, target] of views) {
		measurements[name] = await render(position, target);
		await page.screenshot({ path: `${out}/model-${name}.png` });
	}
	for (const tier of ["Balanced", "Light"]) {
		await page.getByRole("button", { name: "Quality settings" }).click();
		await page.getByRole("radio", { name: tier, exact: true }).check();
		await page.keyboard.press("Escape");
		await page.waitForTimeout(500);
		measurements[tier.toLowerCase()] = await render(views[0][1], views[0][2]);
		await page.screenshot({ path: `${out}/model-${tier.toLowerCase()}.png` });
	}
	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(500);
	measurements.phone = await render(views[0][1], views[0][2]);
	await page.screenshot({ path: `${out}/model-phone.png` });
	const bytes = readFileSync(
		new URL("../public/models/creamery.glb", import.meta.url),
	);
	const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
	const primitives = gltf.meshes.flatMap((mesh) => mesh.primitives);
	const report = {
		bytes: bytes.length,
		meshes: gltf.meshes.length,
		primitives: primitives.length,
		triangles: primitives.reduce(
			(sum, primitive) => sum + gltf.accessors[primitive.indices].count / 3,
			0,
		),
		images: gltf.images.length,
		measurements,
	};
	writeFileSync(
		`${out}/model-metrics.json`,
		`${JSON.stringify(report, null, 2)}\n`,
	);
	console.log("Model review:", JSON.stringify(report));
}
