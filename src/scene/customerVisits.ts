import {
	type Material,
	MathUtils,
	Mesh,
	type Object3D,
	Quaternion,
	Vector3,
} from "three";
import type { QualityTier } from "./quality.ts";

type Cat = {
	position: Vector3 | undefined;
	readonly resting: boolean;
	readonly blocksSidewalk?: boolean;
};
type Phase =
	| "quiet"
	| "approach"
	| "sit"
	| "greet"
	| "cup"
	| "cookie"
	| "enjoy"
	| "return"
	| "goodbye"
	| "stand"
	| "leave";

const START_X = -7.8;
const AISLE_X = -1.25;
const SEAT_X = -0.95;
// Leave room for relaxed hands beside the stools, with both feet on the sidewalk.
const LANE_Z = 2.4;
const SPEED = 0.65;
// Let each completed gesture settle before beginning the next action.
const ACTION_PAUSE = 1.2;
const smooth = (value: number) => {
	const t = MathUtils.clamp(value, 0, 1);
	return t * t * (3 - 2 * t);
};
const pulse = (t: number) => Math.sin(Math.PI * MathUtils.clamp(t, 0, 1)) ** 2;
const durations: Partial<Record<Phase, number>> = {
	sit: 3,
	greet: 2.4,
	cup: 4,
	cookie: 3.6,
	enjoy: 16,
	return: 4,
	goodbye: 2.8,
	stand: 3,
};
const sequence: Phase[] = [
	"approach",
	"sit",
	"greet",
	"cup",
	"cookie",
	"enjoy",
	"return",
	"goodbye",
	"stand",
	"leave",
	"quiet",
];

/** Only active Street View time schedules arrivals. Customers wait offscreen
 * or at their stool while cats clear the shared sidewalk, then walk forward.
 * The reservation lasts through the whole walk, including when reading a Section.
 */
export function createVisitSchedule(random = Math.random) {
	const state = {
		phase: "quiet" as Phase,
		time: 0,
		progress: 0,
		variant: 0,
		x: START_X,
		waiting: false,
		walking: 0,
		gait: 0,
	};
	let quiet = 5;
	let visits = 0;
	let inStreet = true;
	function next() {
		state.phase = sequence[sequence.indexOf(state.phase) + 1] ?? "quiet";
		state.time = state.progress = 0;
		if (state.phase === "quiet")
			quiet = 15 + MathUtils.clamp(random(), 0, 1) * 15;
	}
	return {
		state,
		get needsSidewalk() {
			return (
				["approach", "sit", "goodbye", "stand", "leave"].includes(
					state.phase,
				) ||
				(state.phase === "quiet" && quiet <= 0 && inStreet)
			);
		},
		update(
			delta: number,
			enabled: boolean,
			street: boolean,
			cats: readonly Cat[],
		) {
			const dt = MathUtils.clamp(delta, 0, 0.05);
			inStreet = street;
			const blocked = cats.some(
				(cat) =>
					cat.blocksSidewalk ??
					(cat.position &&
						cat.position.y < 0.4 &&
						cat.position.z > 2.05 &&
						cat.position.x < AISLE_X + 0.6),
			);
			if (!enabled) {
				quiet = 5;
				visits = 0;
				Object.assign(state, {
					phase: "quiet",
					time: 0,
					progress: 0,
					variant: 0,
					x: START_X,
					waiting: false,
					walking: 0,
					gait: 0,
				});
				return state;
			}
			state.walking = 0;
			state.waiting = false;
			if (state.phase === "quiet") {
				if (street) quiet -= dt;
				if (quiet <= 0 && !blocked && street) {
					state.phase = "approach";
					state.variant = visits++ % 2;
					state.x = START_X;
					state.time = state.progress = 0;
				}
				return state;
			}
			if (state.phase === "approach" || state.phase === "leave") {
				const speed = blocked ? 0 : SPEED;
				state.waiting = blocked;
				const direction = state.phase === "approach" ? 1 : -1;
				state.walking = speed / SPEED;
				state.gait += speed * dt * 14;
				state.x += direction * speed * dt;
				state.time += dt;
				if (direction > 0 && state.x >= AISLE_X) {
					state.x = AISLE_X;
					next();
				} else if (direction < 0 && state.x <= START_X) next();
				return state;
			}
			state.time += dt;
			const duration = durations[state.phase] ?? 1;
			state.progress = Math.min(1, state.time / duration);
			state.waiting =
				state.phase === "goodbye" && state.progress >= 1 && blocked;
			if (state.time >= duration + ACTION_PAUSE && !state.waiting) next();
			return state;
		},
	};
}

function required(root: Object3D, name: string) {
	const object = root.getObjectByName(`rig_${name}`);
	if (!object) throw new Error(`Creamery model is missing rig_${name}`);
	return object;
}

const down = new Vector3(0, -1, 0);
const upright = new Quaternion();

/** Analytic two-bone reach, with all scratch vectors allocated once per arm. */
function arm(root: Object3D, prefix: string, length: number, side: number) {
	const upper = required(root, `${prefix}_upper`);
	const lower = required(root, `${prefix}_lower`);
	const hand = required(root, `${prefix}_hand`);
	const origin = new Vector3();
	const direction = new Vector3();
	const bend = new Vector3();
	const elbow = new Vector3();
	const target = new Vector3();
	const q = new Quaternion();
	const parentQ = new Quaternion();
	function orient(object: Object3D, toward: Vector3) {
		q.setFromUnitVectors(down, toward.normalize());
		object.parent?.getWorldQuaternion(parentQ);
		object.quaternion.copy(parentQ.invert()).multiply(q);
		object.updateWorldMatrix(false, true);
	}
	return {
		hand,
		reach(to: Vector3, orientation: Quaternion, relaxed = 0) {
			upper.getWorldPosition(origin);
			direction.subVectors(to, origin);
			const distance = MathUtils.clamp(
				direction.length(),
				0.02,
				length * 2 - 0.0001,
			);
			direction.normalize();
			target.copy(origin).addScaledVector(direction, distance);
			// A relaxed elbow bends gently behind the body. Reaching opens it
			// outward; both poles rotate with the character, never the street.
			bend.set(
				side * MathUtils.lerp(0.7, 0.1, relaxed),
				-1,
				MathUtils.lerp(-0.15, -0.7, relaxed),
			);
			upper.parent?.getWorldQuaternion(parentQ);
			bend.applyQuaternion(parentQ);
			bend.addScaledVector(direction, -bend.dot(direction)).normalize();
			elbow
				.copy(origin)
				.addScaledVector(direction, distance / 2)
				.addScaledVector(
					bend,
					Math.sqrt(length * length - (distance * distance) / 4),
				);
			orient(upper, bend.subVectors(elbow, origin));
			orient(lower, bend.subVectors(target, elbow));
			lower.getWorldQuaternion(parentQ);
			hand.quaternion.copy(parentQ.invert()).multiply(orientation);
			hand.updateWorldMatrix(false, true);
		},
	};
}

function regular(root: Object3D, id: number) {
	const prefix = `prop_customer_${id}`;
	const travel = required(root, `${prefix}_travel`);
	const body = required(root, `${prefix}_body`);
	const head = required(root, `${prefix}_head`);
	const eyes = required(root, `${prefix}_eyes`);
	const materials = new Set<Material>();
	travel.traverse((object) => {
		if (!(object instanceof Mesh)) return;
		for (const material of Array.isArray(object.material)
			? object.material
			: [object.material]) {
			material.alphaHash = true;
			material.needsUpdate = true;
			materials.add(material);
		}
	});
	return {
		materials,
		travel,
		body,
		head,
		eyes,
		left: arm(root, `${prefix}_left`, 0.32, -1),
		right: arm(root, `${prefix}_right`, 0.32, 1),
		legs: ["left", "right"].map((side) => ({
			thigh: required(root, `${prefix}_${side}_thigh`),
			shin: required(root, `${prefix}_${side}_shin`),
			foot: required(root, `${prefix}_${side}_foot`),
		})),
	};
}

/** Owns the complete service choreography, including JJ's arms and the Props.
 * Food follows actual grips. Reparenting happens once on binding; world-space
 * pose curves keep transfers continuous and prevent duplicate cups/cookies.
 */
export function createCustomerVisits(root: Object3D, random = Math.random) {
	const schedule = createVisitSchedule(random);
	const regulars = [regular(root, 1), regular(root, 2)];
	const jjCup = arm(root, "barista_cup", 0.43, 1);
	const jjTray = arm(root, "barista_tray", 0.43, -1);
	const jjHead = required(root, "barista_head");
	const cup = required(root, "service_cup");
	const milk = required(root, "service_milk");
	const tray = required(root, "service_tray");
	const cookie = required(root, "service_cookie");
	// Creamery's GLB root is identity. These Props have independent world paths.
	root.attach(cup);
	root.attach(tray);
	root.attach(cookie);
	const cupHome = new Vector3(-0.62, 1.31, 1.055);
	const trayHome = new Vector3(-1.18, 1.31, 1.04);
	const cupMeet = new Vector3(-0.7, 1.28, 1.35);
	const trayMeet = new Vector3(-1.18, 1.27, 1.32);
	const cupRest = new Vector3(-0.73, 1.02, 1.62);
	const cookieRest = new Vector3(-1.16, 1.03, 1.64);
	const mouth = new Vector3(-0.95, 1.205, 1.705);
	const left = new Vector3();
	const right = new Vector3();
	const jjLeft = new Vector3();
	const jjRight = new Vector3();
	const cupTarget = new Vector3();
	const cookieTarget = new Vector3();
	const trayTarget = new Vector3();
	const wave = new Vector3();
	const orientation = new Quaternion();
	const handOrientation = new Quaternion();
	const tilt = new Quaternion();
	const xAxis = new Vector3(1, 0, 0);
	const shadow = {
		position: regulars[0].travel.position,
		shadowHeight: 0,
		shadowOpacity: 0,
		size: 0.48,
	};
	let clock = 0;
	function place(prop: Object3D, position: Vector3, rotation = upright) {
		prop.position.copy(position);
		prop.quaternion.copy(rotation);
	}
	return {
		state: schedule.state,
		get needsSidewalk() {
			return schedule.needsSidewalk;
		},
		shadow,
		update(
			delta: number,
			enabled: boolean,
			street: boolean,
			cats: readonly Cat[],
			quality: QualityTier = "full",
		) {
			const dt = MathUtils.clamp(delta, 0, 0.05);
			clock = enabled ? clock + dt : 0;
			const state = schedule.update(dt, enabled, street, cats);
			const still = !enabled;
			const phase = still ? "enjoy" : state.phase;
			const customer = regulars[still ? 0 : state.variant];
			for (const r of regulars)
				r.travel.visible = r === customer && phase !== "quiet";
			// A brief dither at the far sidewalk edge avoids popping when orbiting
			// or zooming out far enough to see the arrival point.
			const opacity =
				phase === "approach" || phase === "leave"
					? smooth((state.x - START_X) / 0.6)
					: 1;
			for (const material of customer.materials) material.opacity = opacity;
			shadow.position = customer.travel.position;
			shadow.shadowOpacity =
				phase !== "quiet" && quality !== "light" ? 0.8 * opacity : 0;
			const p = state.progress;
			const t = state.time;
			const detail = enabled && quality !== "light" ? 1 : 0;
			let seated = 1;
			let walk = 0;
			let yaw = Math.PI;
			let x = SEAT_X;
			let z = 1.9;
			if (phase === "approach" || phase === "leave" || phase === "quiet") {
				seated = 0;
				x = state.x;
				z = LANE_Z;
				walk = state.walking;
				yaw = phase === "leave" ? Math.PI * 1.5 : Math.PI / 2;
			} else if (phase === "sit" || phase === "stand") {
				const progress = phase === "sit" ? p : 1 - p;
				// Step through the gap beside the seat, then settle sideways onto it.
				z = MathUtils.lerp(LANE_Z, 1.9, smooth(progress / 0.6));
				x = MathUtils.lerp(AISLE_X, SEAT_X, smooth((progress - 0.4) / 0.6));
				seated = smooth((progress - 0.35) / 0.65);
				walk = Math.sin(Math.PI * smooth(progress / 0.6)) * 0.35;
				yaw = MathUtils.lerp(
					phase === "sit" ? Math.PI / 2 : Math.PI * 1.5,
					Math.PI,
					smooth(progress / 0.35),
				);
			}
			customer.travel.position.set(
				x,
				0.005 * Math.abs(Math.sin(state.gait)) * walk,
				z,
			);
			customer.travel.rotation.set(0, yaw, 0);
			customer.body.rotation.set(0, 0, 0);
			customer.head.rotation.set(
				detail * Math.sin(clock * 1.2) * 0.025 + (state.waiting ? 0.12 : 0),
				detail * Math.sin(clock * 0.6) * 0.045,
				0,
			);
			customer.eyes.scale.y =
				1 - detail * 0.92 * pulse(((clock + state.variant) % 6) / 0.23);
			customer.legs.forEach((leg, i) => {
				const stride = Math.sin(state.gait + i * Math.PI) * walk;
				leg.thigh.rotation.x = (-Math.PI / 2) * seated + stride * 0.4;
				leg.shin.rotation.x =
					(Math.PI / 2) * seated + Math.max(0, -stride) * 0.55;
				leg.foot.rotation.x = -leg.thigh.rotation.x - leg.shin.rotation.x;
			});
			customer.travel.updateWorldMatrix(true, true);
			orientation.copy(customer.travel.quaternion);
			// Relaxed hands beside the hips, forward over the knees when seated.
			left.set(-0.23, 0.5 + seated * 0.49, 0.03 + seated * 0.23);
			right.set(0.23, 0.5 + seated * 0.49, 0.03 + seated * 0.23);
			left.z += Math.sin(state.gait) * walk * 0.09;
			right.z -= Math.sin(state.gait) * walk * 0.09;
			customer.travel.localToWorld(left);
			customer.travel.localToWorld(right);
			jjRight.copy(cupHome);
			jjLeft.copy(trayHome);
			cupTarget.copy(cupHome);
			trayTarget.copy(trayHome);
			cookieTarget.copy(trayHome).add(wave.set(0.045, 0.03, 0));
			let customerCup = false;
			let customerCookie = false;
			let sip = 0;
			let bite = 0;
			cookie.visible = true;
			cookie.scale.setScalar(1);
			milk.visible = true;
			if (phase === "greet" || phase === "goodbye") {
				const greeting = pulse(p);
				wave.set(0.28, state.variant === 0 ? 1.27 : 1.1, 0.18);
				customer.travel.localToWorld(wave);
				right.lerp(wave, greeting);
				customer.head.rotation.x +=
					greeting * (state.variant === 0 ? 0.07 : 0.2);
				jjHead.rotation.x = greeting * 0.1;
			}
			if (phase === "cup") {
				const reach = smooth(p / 0.5);
				jjRight.lerp(cupMeet, reach);
				left.lerp(cupMeet, reach);
				cupTarget.copy(jjRight);
				if (p >= 0.5) {
					customerCup = true;
					cupTarget.lerpVectors(cupMeet, cupRest, smooth((p - 0.5) / 0.5));
					left.copy(cupTarget);
					jjRight.lerp(cupHome, smooth((p - 0.5) / 0.5));
				}
			}
			if (["cookie", "enjoy", "return"].includes(phase)) {
				customerCup = true;
				cupTarget.copy(cupRest);
				left.copy(cupTarget);
			}
			if (phase === "cookie") {
				const reach = smooth(p / 0.5);
				trayTarget.lerp(trayMeet, reach);
				cookieTarget.copy(trayTarget).add(wave.set(0.045, 0.03, 0));
				right.lerp(cookieTarget, reach);
				if (p >= 0.5) {
					customerCookie = true;
					cookieTarget.lerpVectors(
						trayMeet,
						cookieRest,
						smooth((p - 0.5) / 0.5),
					);
					// Cookie starts on the near side of JJ's tray.
					cookieTarget.x += 0.045 * (1 - smooth((p - 0.5) / 0.5));
					cookieTarget.y += 0.03 * (1 - smooth((p - 0.5) / 0.5));
					right.copy(cookieTarget);
					trayTarget.lerp(trayHome, smooth((p - 0.5) / 0.5));
				}
			}
			if (phase === "enjoy") {
				customerCookie = true;
				// Settle with the food, then take an unhurried sip and bite.
				const eating = Math.max(0, (t - 2) / 2);
				sip = still ? 0 : pulse(eating / 2.4);
				bite = still ? 0 : pulse((eating - 2.6) / 1.8);
				cupTarget.lerp(mouth, sip);
				cupTarget.y -= sip * 0.035;
				cookieTarget.copy(cookieRest).lerp(mouth, bite);
				left.copy(cupTarget);
				right.copy(cookieTarget);
				milk.visible = still || eating < 1.6;
				cookie.scale.setScalar(
					still || eating < 3.5 ? 1 : Math.max(0, 1 - (eating - 3.5) / 0.9),
				);
				customer.head.rotation.z = detail * pulse((eating - 4.1) / 0.9) * 0.1;
			}
			if (phase === "return") {
				milk.visible = cookie.visible = false;
				const reach = smooth(p / 0.5);
				cupTarget.lerp(cupMeet, reach);
				left.copy(cupTarget);
				jjRight.lerp(cupMeet, reach);
				if (p >= 0.5) {
					customerCup = false;
					cupTarget.lerpVectors(cupMeet, cupHome, smooth((p - 0.5) / 0.5));
					jjRight.copy(cupTarget);
					left.lerp(cupRest, smooth((p - 0.5) / 0.5));
				}
			}
			if (["goodbye", "stand", "leave", "quiet"].includes(phase)) {
				// JJ lowers the empty cup and tray behind the counter to replenish.
				const lower =
					phase === "goodbye"
						? smooth(p)
						: phase === "stand"
							? 1 - smooth(p)
							: 0;
				jjRight.y -= lower * 0.5;
				jjRight.z -= lower * 0.2;
				trayTarget.y -= lower * 0.5;
				trayTarget.z -= lower * 0.3;
				cupTarget.copy(jjRight);
				milk.visible = phase !== "goodbye";
				cookie.visible = phase !== "goodbye";
				cookieTarget.copy(trayTarget).add(wave.set(0.045, 0.03, 0));
			}
			jjLeft.copy(trayTarget).y -= 0.055;
			jjCup.reach(jjRight, upright);
			jjTray.reach(jjLeft, upright);
			tilt.setFromAxisAngle(xAxis, -sip * 0.7);
			customer.left.reach(
				left,
				handOrientation.copy(orientation).multiply(tilt),
				1 - seated,
			);
			customer.right.reach(right, orientation, 1 - seated);
			// Render at the solved grip, even at a reach limit.
			(customerCup ? customer.left.hand : jjCup.hand).getWorldPosition(
				cupTarget,
			);
			// Keep the label's orientation through both handoffs. Only the sip
			// tips the vessel; changing owners must not spin it half a turn.
			place(cup, cupTarget);
			cup.rotation.x = sip * 0.7;
			jjTray.hand.getWorldPosition(trayTarget).y += 0.055;
			place(tray, trayTarget);
			if (customerCookie) customer.right.hand.getWorldPosition(cookieTarget);
			place(cookie, cookieTarget);
			if (phase !== "quiet" && phase !== "approach" && phase !== "leave") {
				jjHead.rotation.y = -0.035;
				jjHead.rotation.x += detail * Math.sin(clock) * 0.015;
			}
			return state;
		},
	};
}
