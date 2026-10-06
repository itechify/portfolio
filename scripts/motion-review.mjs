import { readFileSync, writeFileSync } from "node:fs";

/** Fixed simulation times and cameras for issues #16/#17. */
export async function reviewMotion(page, out, baseline = false) {
	await page.evaluate(async (baseline) => {
		const resource = performance
			.getEntriesByType("resource")
			.find((r) => r.name.includes("/@react-three_fiber"));
		const { _roots } = await import(resource.name);
		const state = _roots.get(document.querySelector("canvas")).store.getState();
		state.setFrameloop("never");
		const source = baseline ? "/blender/renders/motion-baseline" : "/src/scene";
		const { createCharacterMotion } = await import(
			`${source}/characterMotion.ts`
		);
		const { createCustomerVisits } = await import(
			`${source}/customerVisits.ts`
		);
		const characters = createCharacterMotion(state.scene);
		const visits = createCustomerVisits(state.scene, () => 0);
		const reset = (tier = "full") => {
			characters(0, false);
			visits.update(0, false, true, [], tier);
		};
		const advance = (enabled = true, tier = "full") => {
			const cats = characters(1 / 60, enabled, true, visits.needsSidewalk);
			visits.update(1 / 60, enabled, true, cats, tier);
			return cats;
		};
		window.motionReview = ({
			phase,
			seconds,
			cat,
			event,
			still = false,
			tier = "full",
		}) => {
			reset(tier);
			let cats;
			let eventFrame = -1;
			if (event) {
				let airborne = false;
				for (let frame = 0; frame < 120 * 60; frame++) {
					cats = advance(true, tier);
					const y = cats[cat - 1].position.y;
					airborne ||= y > 1.001;
					if (
						(event === "launch" && airborne) ||
						(event === "land" && airborne && Math.abs(y - 0.59) < 0.00001)
					) {
						eventFrame = frame;
						break;
					}
				}
				if (eventFrame < 0) throw new Error(`Cat did not reach ${event}`);
				reset(tier);
			}
			for (let frame = 0; frame < 180 * 60; frame++) {
				cats = advance(!still, tier);
				const visit = visits.state;
				if (
					still ||
					(event
						? frame >= eventFrame + Math.round(seconds * 60)
						: phase
							? visit.phase === phase && visit.time >= seconds
							: frame / 60 >= seconds)
				)
					break;
				if (frame === 180 * 60 - 1)
					throw new Error("Motion pose was not reached");
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
			const position = cat ? cats[cat - 1].position : visits.shadow.position;
			if (cat) {
				state.camera.position.set(
					position.x + 0.65,
					position.y + 0.52,
					position.z + 0.9,
				);
				state.camera.lookAt(position.x, position.y + 0.17, position.z);
			} else {
				state.camera.position.set(position.x + 2.3, 1.8, 4.1);
				state.camera.lookAt(position.x, 0.75, 1.95);
			}
			state.camera.updateMatrixWorld();
			state.gl.info.autoReset = false;
			state.gl.info.reset();
			for (const sub of state.internal.subscribers)
				if (sub.priority > 0) sub.ref.current(state, 0);
			const metrics = {
				calls: state.gl.info.render.calls,
				triangles: state.gl.info.render.triangles,
				textures: state.gl.info.memory.textures,
			};
			state.gl.info.autoReset = true;
			return {
				...metrics,
				visit: { ...visits.state },
				cats: cats.map((c) => c.position.toArray()),
			};
		};
		window.motionBenchmark = () => {
			const batches = [];
			for (let batch = 0; batch < 6; batch++) {
				reset();
				const start = performance.now();
				for (let frame = 0; frame < 6000; frame++) advance();
				if (batch) batches.push((performance.now() - start) / 6000);
			}
			return {
				meanMillisecondsPerUpdate:
					batches.reduce((a, b) => a + b, 0) / batches.length,
				batches,
			};
		};
	}, baseline);
	const poses = [
		["walk", { phase: "approach", seconds: 9 }],
		["turn", { phase: "sit", seconds: 0.8 }],
		["sit", { phase: "sit", seconds: 2.1 }],
		["settle", { phase: "sit", seconds: 2.8 }],
		["seated", { phase: "sit", seconds: 3.2 }],
		["stand", { phase: "stand", seconds: 1.2 }],
		["depart", { phase: "leave", seconds: 1 }],
		["cat-turn", { seconds: 7.7, cat: 1 }],
		["cat-walk", { seconds: 9.1, cat: 1 }],
		["cat-crouch", { event: "launch", seconds: -0.1, cat: 1 }],
		["cat-land", { event: "land", seconds: 0.2, cat: 1 }],
		["freya-land", { event: "land", seconds: 0.2, cat: 2 }],
		["coexist", { phase: "enjoy", seconds: 2 }],
		["reduced", { still: true }],
	];
	const metrics = {};
	for (const [name, pose] of poses) {
		metrics[name] = await page.evaluate(
			(pose) => window.motionReview(pose),
			pose,
		);
		await page.screenshot({ path: `${out}/${name}.png` });
	}
	metrics.controller = await page.evaluate(() => window.motionBenchmark());
	for (const [label, width, height] of [
		["light", 1280, 800],
		["narrow", 390, 844],
	]) {
		await page.setViewportSize({ width, height });
		await page.getByRole("button", { name: "Quality settings" }).click();
		await page.getByRole("radio", { name: "Light", exact: true }).check();
		await page.keyboard.press("Escape");
		await page.waitForTimeout(500);
		metrics[label] = await page.evaluate(() =>
			window.motionReview({ phase: "sit", seconds: 2.4, tier: "light" }),
		);
		await page.screenshot({ path: `${out}/${label}.png` });
	}
	const bytes = readFileSync(
		new URL(
			baseline
				? "../blender/renders/motion-baseline/creamery.glb"
				: "../public/models/creamery.glb",
			import.meta.url,
		),
	);
	const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
	metrics.model = {
		bytes: bytes.length,
		meshes: gltf.meshes.length,
		triangles: gltf.meshes
			.flatMap((m) => m.primitives)
			.reduce((total, p) => total + gltf.accessors[p.indices].count / 3, 0),
	};
	writeFileSync(`${out}/metrics.json`, `${JSON.stringify(metrics, null, 2)}\n`);
}
