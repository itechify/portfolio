import type { Object3D } from "three";
import { createCatMotion } from "./catMotion.ts";

/** A soft, occasional gesture with a still interval between repetitions. */
function gesture(
	time: number,
	period: number,
	start: number,
	duration: number,
) {
	const phase = (time % period) - start;
	if (phase <= 0 || phase >= duration) return 0;
	return Math.sin((phase / duration) * Math.PI) ** 2;
}

function blink(time: number, period: number) {
	return 1 - 0.94 * gesture(time, period, 0.4, 0.22);
}

/** Bind once. Per-frame work only changes rigid pivots.
 * The barista keeps small gestures; cats have portable baked shading (ADR 0001).
 * Blender exports these unrotated Empty pivots in glTF's Y-up coordinates.
 */
export function createCharacterMotion(root: Object3D) {
	const cats = createCatMotion(root);
	// Customer visits own JJ's arms and serving Props; these are his idle face.
	const names = ["barista_head", "barista_eyes"];
	const joints = new Map(
		names.flatMap((name) => {
			const object = root.getObjectByName(`rig_${name}`);
			return object
				? [
						[
							name,
							{
								object,
								rotation: object.rotation.clone(),
								scale: object.scale.clone(),
							},
						] as const,
					]
				: [];
		}),
	);
	function rotate(name: string, x: number, y: number, z = 0) {
		const joint = joints.get(name);
		if (!joint) return;
		joint.object.rotation.set(
			joint.rotation.x + x,
			joint.rotation.y + y,
			joint.rotation.z + z,
		);
	}
	function stretch(name: string, y: number) {
		const joint = joints.get(name);
		if (joint) joint.object.scale.y = joint.scale.y * y;
	}
	let time = 0;
	let moving = false;
	return (delta: number, enabled: boolean, street = true) => {
		const step = Math.max(0, Math.min(delta, 0.05));
		cats.update(step, enabled, street);
		if (!enabled) {
			if (moving) {
				for (const joint of joints.values()) {
					joint.object.rotation.copy(joint.rotation);
					joint.object.scale.copy(joint.scale);
				}
			}
			moving = false;
			time = 0;
			return cats.cats;
		}
		moving = true;
		// Do not jump through a gesture after a background tab or a long frame.
		time += step;
		const serve = gesture(time, 13, 3, 4);
		const glance = gesture(time, 17, 9, 5);
		rotate("barista_head", 0.065 * serve, 0.16 * glance - 0.09 * serve);
		stretch("barista_eyes", blink(time, 6.7));
		return cats.cats;
	};
}
