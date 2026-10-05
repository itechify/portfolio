import { MathUtils, type Object3D, Vector3 } from "three";
import { createBlink, createFootstep, createLeg, ease } from "./limbMotion.ts";

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
	launchSpeed: number;
	prepare: number;
};

function cat(root: Object3D, id: number, route: readonly Point[]) {
	const prefix = `rig_prop_cat_${id}`;
	const travel = bind(root, `${prefix}_travel`);
	const body = bind(root, `${prefix}_body`);
	const head = bind(root, `${prefix}_head`);
	const tail = bind(root, `${prefix}_tail`);
	const tailEnd = bind(root, `${prefix}_tail_end`);
	const haunch = bind(root, `${prefix}_haunch`);
	const ears = ["left", "right"].map((side) =>
		bind(root, `${prefix}_ear_${side}`),
	);
	const eyes = bind(root, `${prefix}_eyes`);
	const blink = createBlink(id * 1.3);
	const legs = ["front_left", "front_right", "hind_left", "hind_right"].map(
		(part) => bind(root, `${prefix}_${part}`),
	);
	const lowers = ["front_left", "front_right", "hind_left", "hind_right"].map(
		(part) => bind(root, `${prefix}_${part}_lower`),
	);
	const paws = ["front_left", "front_right", "hind_left", "hind_right"].map(
		(part) => bind(root, `${prefix}_${part}_paw`),
	);
	const feet = legs.map((leg, i) =>
		leg && lowers[i] && paws[i]
			? {
					leg: createLeg(leg.object, lowers[i].object, paws[i].object),
					step: createFootstep(),
				}
			: null,
	);
	const joints = [
		travel,
		body,
		head,
		tail,
		tailEnd,
		haunch,
		eyes,
		...ears,
		...legs,
		...lowers,
		...paws,
	];
	const footTarget = new Vector3();
	const pole = new Vector3();
	const velocity = new Vector3();
	const nextFootfall = new Vector3();
	const footfalls = legs.map(() => new Vector3());
	const launchPaws = legs.map(() => new Vector3());
	let nextPair = 0;
	let wasAirborne = false;
	const previousPosition = travel?.position.clone() ?? new Vector3();
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
	let compression = 0;
	let airborne = false;
	let landing = 0;

	function depart(toNode: number, chasing = false) {
		if (!travel) return;
		const from = travel.object.position.clone();
		const to = new Vector3(...route[toNode]);
		const hop = Math.abs(from.y - to.y) > 0.1;
		const launchSpeed = Math.sqrt(
			2 * 9.8 * (Math.max(0, to.y - from.y) + 0.14),
		);
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
				? (launchSpeed +
						Math.sqrt(launchSpeed ** 2 - 2 * 9.8 * (to.y - from.y))) /
					9.8
				: Math.max(0.65, from.distanceTo(to) / (chasing ? 0.5 : 0.22)),
			hop,
			chasing,
			launchSpeed,
			prepare: chasing ? 0.7 : 1.4,
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
		velocity.subVectors(
			travel?.object.position ?? previousPosition,
			previousPosition,
		);
		previousPosition.copy(travel?.object.position ?? previousPosition);
		gait += Math.hypot(velocity.x, velocity.z) * 45;
		if (delta > 0) velocity.divideScalar(delta);
		velocity.y = 0;
		// Unfold the seated body above the planted paws as the cat rises.
		// Travel stays on the support plane so steps and landings remain grounded.
		const standingLift = 0.04 * posture;
		body.object.rotation.x = body.rotation.x + 0.95 * posture + 0.13 * stretch;
		body.object.position.y =
			body.position.y +
			standingLift +
			0.006 * Math.sin(gait * 2) * moving -
			0.022 * compression -
			0.008 * stretch;
		body.object.scale.y = 1 + 0.008 * Math.sin(idleTime * 1.7 + id * 2.1);
		if (haunch) {
			haunch.object.rotation.x = 0.18 * posture - 0.08 * compression;
			haunch.object.position.y =
				haunch.position.y + standingLift - 0.012 * compression;
		}
		const glance =
			Math.sin(
				Math.PI * MathUtils.clamp((((idleTime + id * 3) % 19) - 5) / 5, 0, 1),
			) ** 2;
		head.object.rotation.x = head.rotation.x - 0.95 * posture;
		head.object.rotation.y = MathUtils.damp(
			head.object.rotation.y,
			head.rotation.y +
				(journey && travel
					? MathUtils.clamp(
							angle(0, journey.heading - travel.object.rotation.y, 1),
							-0.5,
							0.5,
						)
					: watch
						? -0.45
						: (id === 1 ? 0.2 : -0.17) * glance),
			5,
			delta,
		);
		// Unwrap the seated curl outwards, away from the haunch. Once it is
		// behind the cat, lift it clear of the walking surface. Mirrored tails
		// need opposite yaw; lifting before the turn would drive the tip down.
		tail.object.rotation.x =
			tail.rotation.x + 0.55 * smooth((posture - 0.55) / 0.45);
		tail.object.position.y =
			tail.position.y + standingLift - 0.012 * compression;
		tail.object.rotation.y =
			tail.rotation.y + (id === 1 ? 2.8 : -2.8) * posture + 0.06 * glance;
		if (tailEnd)
			tailEnd.object.rotation.y =
				0.12 * glance + 0.045 * Math.sin(gait - 0.6) * moving;
		ears.forEach((ear, i) => {
			if (ear)
				ear.object.rotation.y = (watch ? -0.16 : 0.1 * glance) * (i ? 0.7 : 1);
		});
		eyes.object.scale.y = blink(delta);
		legs.forEach((leg, i) => {
			if (!leg) return;
			leg.object.position.z =
				leg.position.z +
				(i < 2 ? 0.095 : -0.015) * posture +
				(i < 2 ? 0.025 * stretch : 0);
			leg.object.position.y =
				leg.position.y - 0.024 * posture - 0.016 * compression;
		});
		if (!travel) return;
		travel.object.updateWorldMatrix(true, true);
		nextFootfall.set(0, 0, 0);
		if (journey && !journey.hop) {
			const j = journey;
			const ahead = j.chasing ? 0.17 : 0.28;
			nextFootfall.lerpVectors(
				j.from,
				j.to,
				smooth((j.elapsed + ahead - j.prepare) / j.duration),
			);
			nextFootfall.sub(travel.object.position).y = 0;
		}
		feet.forEach((foot, i) => {
			const leg = legs[i];
			if (!foot || !leg) return;
			footfalls[i].set(
				leg.object.position.x,
				i < 2 ? 0.018 : 0.019,
				leg.object.position.z,
			);
			travel.object.localToWorld(footfalls[i]).add(nextFootfall);
		});
		let steppingPair = -1;
		if (!airborne && !feet.some((foot) => foot?.step.swinging)) {
			for (const pair of [nextPair, 1 - nextPair]) {
				if (
					feet.some(
						(foot, i) =>
							foot &&
							(i === 0 || i === 3 ? 0 : 1) === pair &&
							(foot.step.target.distanceTo(footfalls[i]) >
								(moving > 0 ? 0.055 : 0.015) ||
								foot.step.rotation.angleTo(travel.object.quaternion) > 0.3),
					)
				) {
					steppingPair = pair;
					nextPair = 1 - pair;
					break;
				}
			}
		}
		feet.forEach((foot, i) => {
			const leg = legs[i];
			if (!foot || !leg) return;
			footTarget.set(
				leg.object.position.x,
				i < 2 ? 0.018 : 0.019,
				leg.object.position.z,
			);
			travel.object.localToWorld(footTarget);
			if (airborne) {
				// Hind legs finish the push; front paws extend first for landing.
				if (!wasAirborne) {
					launchPaws[i].copy(foot.step.target);
					travel.object.worldToLocal(launchPaws[i]);
				}
				footTarget.y += hop * (i < 2 ? 0.02 : 0.037);
				travel.object.worldToLocal(footTarget);
				footTarget.lerpVectors(
					launchPaws[i],
					footTarget,
					ease(
						((journey?.elapsed ?? 0) - (journey?.prepare ?? 0)) /
							(i < 2 ? 0.1 : 0.14),
					),
				);
				travel.object.localToWorld(footTarget);
				if (i < 2 && journey) {
					const progress =
						(journey.elapsed - journey.prepare) / journey.duration;
					if (progress > 0.65)
						footTarget.y = Math.max(
							journey.to.y + 0.018,
							footTarget.y - 0.012 * smooth((progress - 0.65) / 0.3),
						);
				}
				foot.step.reset();
			} else {
				footTarget.copy(footfalls[i]);
				footTarget.y = travel.object.position.y + (i < 2 ? 0.018 : 0.019);
				foot.step.update(
					delta,
					footTarget,
					travel.object.quaternion,
					steppingPair === (i === 0 || i === 3 ? 0 : 1),
					-1,
					journey?.chasing ? 0.1 : 0.17,
					0.022,
				);
				footTarget.copy(foot.step.target);
			}
			pole.set(0, 0, i < 2 ? -1 : 1).applyQuaternion(travel.object.quaternion);
			foot.leg.solve(
				footTarget,
				airborne ? travel.object.quaternion : foot.step.rotation,
				pole,
			);
		});
		wasAirborne = airborne;
	}

	return {
		get node() {
			return node;
		},
		get resting() {
			return journey === null;
		},
		get blocksSidewalk() {
			// Include committed hops/steps before their position reaches the lane.
			const blocks = (index: number) => id === 1 && index >= 3 && index <= 4;
			return (
				blocks(node) ||
				!!(journey && (blocks(journey.fromNode) || blocks(journey.toNode)))
			);
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
			compression = landing = 0;
			nextPair = 0;
			wasAirborne = false;
			airborne = false;
			previousPosition.copy(travel?.position ?? previousPosition);
			for (const foot of feet) foot?.step.reset();
			blink(0, false);
			shadowHeight = route[0][1];
			shadowOpacity = 1;
			wasStreet = true;
		},
		update(
			delta: number,
			street: boolean,
			hunt: "prepare" | "chase" | null,
			watch: boolean,
			clearSidewalk = false,
		) {
			if (!travel) return;
			if (!street && wasStreet && journey && !journey.hop && !clearSidewalk) {
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
			if (
				!street &&
				!journey &&
				!(clearSidewalk && id === 1 && node >= 3 && node < 5)
			)
				return;
			idleTime += delta;
			if (!journey) {
				rest -= delta;
				if (clearSidewalk && id === 1 && node >= 3 && hunt !== "chase") {
					// Finish along the existing route to the clear space on the right.
					// This also lets a customer leave after a Section opens.
					if (node < 5) depart(node + 1);
					else rest = Math.max(rest, 2);
				} else if (hunt === "prepare" && node !== 3)
					depart(node + (node < 3 ? 1 : -1));
				else if (hunt === "chase" && node < 6) depart(node + 1, true);
				else if (!hunt && rest <= 0 && street) {
					const last = id === 1 ? 4 : 2;
					if (node >= last) direction = -1;
					if (node === 0) direction = 1;
					// Stay on the stool while a customer owns the shared sidewalk.
					if (!(clearSidewalk && id === 1 && node === 2 && direction > 0))
						depart(node + direction);
				}
			}
			let moving = 0;
			let hop = 0;
			compression = 0;
			airborne = false;
			if (journey) {
				const j = journey;
				j.elapsed += delta;
				const prepare = j.prepare;
				const finish = j.hop ? 0.85 : 0.6;
				const progress = MathUtils.clamp(
					(j.elapsed - prepare) / j.duration,
					0,
					1,
				);
				posture =
					MathUtils.lerp(
						j.posture,
						1,
						smooth((j.elapsed - prepare * 0.4) / (prepare * 0.6)),
					) *
					(1 - smooth((j.elapsed - prepare - j.duration) / finish));
				travel.object.rotation.y = angle(
					j.yaw,
					j.heading,
					smooth((j.elapsed - 0.12) / (prepare * 0.55)),
				);
				// Smooth acceleration and braking, with exact support-plane landings.
				travel.object.position.lerpVectors(
					j.from,
					j.to,
					j.hop ? progress : smooth(progress),
				);
				hop = j.hop ? Math.sin(Math.PI * progress) : 0;
				if (j.hop) {
					const flightTime = progress * j.duration;
					travel.object.position.y =
						j.from.y + j.launchSpeed * flightTime - 4.9 * flightTime ** 2;
					airborne = progress > 0 && progress < 1;
					landing = Math.max(0, j.elapsed - prepare - j.duration);
					compression =
						j.elapsed < prepare
							? Math.sin(Math.PI * ease(j.elapsed / prepare)) ** 2
							: Math.sin(Math.PI * Math.min(1, landing / 0.38)) ** 2;
				}
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
					const variation = (visits * 0.61803398875 + id * 0.31) % 1;
					rest = id === 1 ? 9 + variation * 10 : 39 + variation * 30;
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
		update(
			delta: number,
			enabled: boolean,
			street: boolean,
			clearSidewalk = false,
		) {
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
				!clearSidewalk &&
				!chase &&
				streetTime >= nextChase &&
				mouse &&
				skadi.position
			)
				chase = "prepare";
			if ((!street || clearSidewalk) && chase === "prepare") {
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
				clearSidewalk,
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
