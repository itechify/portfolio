import { MathUtils, type Object3D, Vector3 } from "three";

type Point = readonly [number, number, number];

// Y-up walking surfaces from build.py. Each cat owns its counter/stool route,
// so a resting Freya cannot occupy Skadi's landing spot. The sidewalk route
// stays in front of the stool bases and inside the curb.
const SKADI: readonly Point[] = [
	[-1.85, 0.99, 1.27],
	[-2.15, 0.99, 1.38],
	[-2.15, 0.59, 1.9],
	[-2.15, 0, 2.3],
	[-0.9, 0, 2.3],
	[0.05, 0, 2.3],
	[0.35, 0, 2.3],
];
const FREYA: readonly Point[] = [
	[-0.13, 0.99, 1.27],
	[-0.35, 0.99, 1.38],
	[-0.35, 0.59, 1.9],
];
const smooth = (t: number) => {
	const p = MathUtils.clamp(t, 0, 1);
	return p * p * (3 - 2 * p);
};
const angle = (from: number, to: number, blend: number) =>
	from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * blend;

function bind(root: Object3D, name: string) {
	const object = root.getObjectByName(name);
	if (!object) return null;
	const position = object.position.clone();
	const rotation = object.rotation.clone();
	const quaternion = object.quaternion.clone();
	const scale = object.scale.clone();
	return {
		object,
		position,
		rotation,
		reset() {
			object.position.copy(position);
			object.quaternion.copy(quaternion);
			object.scale.copy(scale);
		},
	};
}

type Journey = {
	from: Vector3;
	to: Vector3;
	fromNode: number;
	toNode: number;
	yaw: number;
	heading: number;
	posture: number;
	elapsed: number;
	duration: number;
	hop: boolean;
	chasing: boolean;
};

function cat(root: Object3D, id: number, route: readonly Point[]) {
	const prefix = `rig_prop_cat_${id}`;
	const travel = bind(root, `${prefix}_travel`);
	const body = bind(root, `${prefix}_body`);
	const head = bind(root, `${prefix}_head`);
	const tail = bind(root, `${prefix}_tail`);
	const eyes = bind(root, `${prefix}_eyes`);
	const legs = ["front_left", "front_right", "hind_left", "hind_right"].map(
		(part) => bind(root, `${prefix}_${part}`),
	);
	const joints = [travel, body, head, tail, eyes, ...legs];
	let node = 0;
	let direction = 1;
	let rest = id === 1 ? 7 : 46;
	let journey: Journey | null = null;
	let posture = 0;
	let gait = 0;
	let idleTime = 0;
	let visits = 0;
	let wasStreet = true;
	let shadowHeight = route[0][1];
	let shadowOpacity = 1;

	function depart(toNode: number, chasing = false) {
		if (!travel) return;
		const from = travel.object.position.clone();
		const to = new Vector3(...route[toNode]);
		const hop = Math.abs(from.y - to.y) > 0.1;
		journey = {
			from,
			to,
			fromNode: node,
			toNode,
			yaw: travel.object.rotation.y,
			heading: Math.atan2(to.x - from.x, to.z - from.z),
			posture,
			elapsed: 0,
			duration: hop
				? 0.95
				: Math.max(0.65, from.distanceTo(to) / (chasing ? 0.85 : 0.22)),
			hop,
			chasing,
		};
	}

	function pose(delta: number, moving: number, hop: number, watch: boolean) {
		if (!body || !head || !tail || !eyes) return;
		const stretch =
			(1 - posture) *
			Math.sin(
				Math.PI * MathUtils.clamp((((idleTime + id * 7) % 47) - 30) / 4, 0, 1),
			) **
				2;
		gait += delta * (journey?.chasing ? 18 : 10) * moving;
		body.object.rotation.x = body.rotation.x + 0.95 * posture + 0.13 * stretch;
		body.object.position.y =
			body.position.y +
			0.006 * Math.sin(gait * 2) * moving -
			0.018 * hop -
			0.008 * stretch;
		body.object.scale.y = 1 + 0.008 * Math.sin(idleTime * 1.7 + id * 2.1);
		const glance =
			Math.sin(
				Math.PI * MathUtils.clamp((((idleTime + id * 3) % 19) - 5) / 5, 0, 1),
			) ** 2;
		head.object.rotation.x = head.rotation.x - 0.95 * posture;
		head.object.rotation.y = MathUtils.damp(
			head.object.rotation.y,
			head.rotation.y + (watch ? -0.45 : (id === 1 ? 0.2 : -0.17) * glance),
			5,
			delta,
		);
		// Unwrap the seated curl outwards, away from the haunch. Once it is
		// behind the cat, lift it clear of the walking surface. Mirrored tails
		// need opposite yaw; lifting before the turn would drive the tip down.
		tail.object.rotation.x =
			tail.rotation.x + 0.55 * smooth((posture - 0.55) / 0.45);
		tail.object.rotation.y =
			tail.rotation.y +
			(id === 1 ? 2.8 : -2.8) * posture +
			Math.sin(idleTime * 1.3) * 0.13;
		const blink =
			Math.sin(
				Math.PI * MathUtils.clamp((((idleTime + id) % 6.7) - 0.4) / 0.22, 0, 1),
			) ** 2;
		eyes.object.scale.y = 1 - 0.94 * blink;
		legs.forEach((leg, i) => {
			if (!leg) return;
			const stride = Math.sin(gait + (i === 0 || i === 3 ? 0 : Math.PI));
			leg.object.rotation.x =
				leg.rotation.x + 0.32 * stride * moving - 0.45 * hop;
			leg.object.position.z =
				leg.position.z +
				(i < 2 ? 0.095 : -0.015) * posture +
				(i < 2 ? 0.025 * stretch : 0);
			leg.object.position.y =
				leg.position.y + Math.max(0, stride) * 0.022 * moving;
		});
	}

	return {
		get node() {
			return node;
		},
		get resting() {
			return journey === null;
		},
		get position() {
			return travel?.object.position;
		},
		get shadowHeight() {
			return shadowHeight;
		},
		get shadowOpacity() {
			return shadowOpacity;
		},
		reset() {
			for (const joint of joints) joint?.reset();
			node = 0;
			direction = 1;
			rest = id === 1 ? 7 : 46;
			journey = null;
			posture = gait = idleTime = visits = 0;
			shadowHeight = route[0][1];
			shadowOpacity = 1;
			wasStreet = true;
		},
		update(
			delta: number,
			street: boolean,
			hunt: "prepare" | "chase" | null,
			watch: boolean,
		) {
			if (!travel) return;
			if (!street && wasStreet && journey && !journey.hop) {
				// Pick the nearer endpoint along the current permitted edge. Hops
				// always land first; never redirect a cat while it is airborne.
				const j = journey;
				const target =
					travel.object.position.distanceTo(j.from) <
					travel.object.position.distanceTo(j.to)
						? j.fromNode
						: j.toNode;
				depart(target);
			}
			if (street && !wasStreet) rest = Math.max(rest, id === 1 ? 4 : 20);
			wasStreet = street;
			if (!street && !journey) return;
			idleTime += delta;
			if (!journey) {
				rest -= delta;
				if (hunt === "prepare" && node !== 3)
					depart(node + (node < 3 ? 1 : -1));
				else if (hunt === "chase" && node < 6) depart(node + 1, true);
				else if (!hunt && rest <= 0 && street) {
					const last = id === 1 ? 4 : 2;
					if (node >= last) direction = -1;
					if (node === 0) direction = 1;
					depart(node + direction);
				}
			}
			let moving = 0;
			let hop = 0;
			if (journey) {
				const j = journey;
				j.elapsed += delta;
				const prepare = j.chasing ? 0.22 : 0.8;
				const finish = 0.6;
				const progress = MathUtils.clamp(
					(j.elapsed - prepare) / j.duration,
					0,
					1,
				);
				posture =
					MathUtils.lerp(j.posture, 1, smooth(j.elapsed / prepare)) *
					(1 - smooth((j.elapsed - prepare - j.duration) / finish));
				travel.object.rotation.y = angle(
					j.yaw,
					j.heading,
					smooth(j.elapsed / prepare),
				);
				// Smooth acceleration and braking, with exact support-plane landings.
				travel.object.position.lerpVectors(j.from, j.to, smooth(progress));
				hop = j.hop ? Math.sin(Math.PI * progress) : 0;
				travel.object.position.y += hop * 0.23;
				moving = j.hop ? 0 : Math.sin(Math.PI * progress);
				shadowHeight = progress < 0.5 ? j.from.y : j.to.y;
				shadowOpacity = 1 - hop;
				if (j.elapsed >= prepare + j.duration + finish) {
					node = j.toNode;
					travel.object.position.copy(j.to);
					shadowHeight = j.to.y;
					shadowOpacity = 1;
					journey = null;
					posture = 0;
					visits++;
					rest = id === 1 ? 10 + (visits % 3) * 4 : 42 + (visits % 3) * 11;
				}
			}
			pose(delta, moving, hop, watch);
		},
	};
}

/** Fixed small route graphs keep traversal predictable and cheap on phones.
 * Only active Street View time schedules activity; disabled motion restores
 * the authored pose, whereas opening a Section lets the cats settle in place.
 */
export function createCatMotion(root: Object3D) {
	const skadi = cat(root, 1, SKADI);
	const freya = cat(root, 2, FREYA);
	const mouse = bind(root, "rig_prop_mouse");
	if (mouse) mouse.object.visible = false;
	let streetTime = 0;
	let nextChase = 60;
	let chase: "prepare" | "chase" | "escape" | null = null;
	let mouseTime = 0;
	let escapeTime = 0;
	const escapeFrom = new Vector3();
	const mouseStart = new Vector3(-2.45, 0, 1.72);
	const mouseCorner = new Vector3(-2.48, 0, 2.47);
	const mouseEnd = new Vector3(1, 0, 1.72);
	const mouseFront = new Vector3(0.7, 0, 2.47);
	const mouseBehind = new Vector3(0.7, 0, 1.72);
	let enabledBefore = false;

	return {
		cats: [skadi, freya],
		update(delta: number, enabled: boolean, street: boolean) {
			if (!enabled) {
				if (enabledBefore) {
					skadi.reset();
					freya.reset();
					mouse?.reset();
				}
				if (mouse) mouse.object.visible = false;
				streetTime = mouseTime = escapeTime = 0;
				nextChase = 60;
				chase = null;
				enabledBefore = false;
				return;
			}
			enabledBefore = true;
			if (street) streetTime += delta;
			if (
				street &&
				!chase &&
				streetTime >= nextChase &&
				mouse &&
				skadi.position
			)
				chase = "prepare";
			if (!street && chase === "prepare") {
				chase = null;
				nextChase = streetTime + 180;
			}
			if (chase === "prepare" && skadi.node === 3 && skadi.resting) {
				chase = "chase";
				mouseTime = 0;
				if (mouse) {
					mouse.object.visible = true;
					mouse.object.position.copy(mouseStart);
				}
			}
			if (chase === "chase" && (!street || mouseTime >= 6.5)) {
				chase = "escape";
				escapeTime = 0;
				if (mouse) escapeFrom.copy(mouse.object.position);
			}
			const hunt = chase === "chase" && mouseTime < 2 ? "prepare" : chase;
			skadi.update(
				delta,
				street,
				hunt === "prepare" || hunt === "chase" ? hunt : null,
				false,
			);
			freya.update(delta, street, null, chase === "chase");
			if (mouse && chase === "chase") {
				mouseTime += delta;
				if (mouseTime < 0.8)
					mouse.object.position.lerpVectors(
						mouseStart,
						mouseCorner,
						smooth(mouseTime / 0.8),
					);
				else
					mouse.object.position.lerpVectors(
						mouseCorner,
						mouseFront,
						smooth((mouseTime - 0.8) / 5.7),
					);
				mouse.object.rotation.y = mouseTime < 0.8 ? 0 : Math.PI / 2;
				mouse.object.position.y = Math.abs(Math.sin(mouseTime * 24)) * 0.008;
			}
			if (mouse && chase === "escape") {
				escapeTime += delta;
				// Follow the clear strip to the right before hiding behind the can.
				if (escapeTime < 0.8)
					mouse.object.position.lerpVectors(
						escapeFrom,
						mouseFront,
						smooth(escapeTime / 0.8),
					);
				else if (escapeTime < 1.4)
					mouse.object.position.lerpVectors(
						mouseFront,
						mouseBehind,
						smooth((escapeTime - 0.8) / 0.6),
					);
				else
					mouse.object.position.lerpVectors(
						mouseBehind,
						mouseEnd,
						smooth((escapeTime - 1.4) / 0.3),
					);
				mouse.object.rotation.y = escapeTime < 0.8 ? Math.PI / 2 : Math.PI;
				if (escapeTime >= 1.7) {
					mouse.object.visible = false;
					chase = null;
					nextChase = streetTime + 210;
				}
			}
		},
	};
}
