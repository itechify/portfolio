import {
	type Material,
	MathUtils,
	Mesh,
	type Object3D,
	Quaternion,
	Vector3,
} from "three";
import {
	createBlink,
	createFootstep,
	createGaze,
	createLeg,
	ease,
} from "./limbMotion.ts";
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
	| "prepare"
	| "cup"
	| "cookie"
	| "enjoy"
	| "return"
	| "clear"
	| "goodbye"
	| "stand"
	| "leave";

const START_X = -7.8;
const AISLE_X = -1.25;
const SEAT_X = -0.95;
// Leave room for relaxed hands beside the stools, with both feet on the sidewalk.
const LANE_Z = 2.4;
const SPEED = 0.65;
// Finished grippers in build.py: 34 mm thick, beneath a 10 mm tray base.
const TRAY_SUPPORT_HEIGHT = 0.027;
// Opposing hands leave a 10 mm gap between their fingers during transfer.
const CUP_GRIP_HEIGHT = 0.022;
// Let each completed gesture settle before beginning the next action.
const pauses: Partial<Record<Phase, number>> = {
	sit: 0.8,
	greet: 0.55,
	prepare: 0.35,
	cup: 0.6,
	cookie: 1.1,
	enjoy: 2.4,
	return: 0.7,
	clear: 0.5,
	goodbye: 0.8,
	stand: 0.3,
};
const smooth = (value: number) => {
	const t = MathUtils.clamp(value, 0, 1);
	return t * t * (3 - 2 * t);
};
const pulse = (t: number) => Math.sin(Math.PI * MathUtils.clamp(t, 0, 1)) ** 2;
const durations: Partial<Record<Phase, number>> = {
	sit: 3,
	greet: 2.4,
	prepare: 13,
	cup: 4,
	cookie: 3.6,
	enjoy: 16,
	return: 4,
	clear: 9,
	goodbye: 2.8,
	stand: 3,
};
const sequence: Phase[] = [
	"approach",
	"sit",
	"greet",
	"prepare",
	"cup",
	"cookie",
	"enjoy",
	"return",
	"clear",
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
	let speed = 0;
	let pace = 1;
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
				speed = 0;
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
					pace = 0.94 + MathUtils.clamp(random(), 0, 1) * 0.12;
					speed = 0;
					state.x = START_X;
					state.time = state.progress = 0;
				}
				return state;
			}
			if (state.phase === "approach" || state.phase === "leave") {
				const remaining = Math.abs(
					state.x - (state.phase === "approach" ? AISLE_X : START_X),
				);
				const desiredSpeed = Math.min(
					SPEED * pace,
					Math.sqrt(2 * 0.8 * remaining),
				);
				speed = blocked ? 0 : Math.min(desiredSpeed, speed + dt * 0.8);
				state.waiting = blocked;
				const direction = state.phase === "approach" ? 1 : -1;
				state.walking = speed / SPEED;
				state.gait += speed * dt * 14;
				state.x += direction * Math.min(remaining, speed * dt);
				state.time += dt;
				if (direction > 0 && state.x >= AISLE_X) {
					state.x = AISLE_X;
					next();
				} else if (direction < 0 && state.x <= START_X) next();
				return state;
			}
			state.time += dt;
			// Preserve the three-second pour; vary enjoyment and the pauses
			// without changing grip ownership during a handoff.
			const duration =
				(durations[state.phase] ?? 1) *
				(state.phase === "enjoy" ? 1 / pace : 1);
			state.progress = Math.min(1, state.time / duration);
			state.waiting =
				state.phase === "goodbye" && state.progress >= 1 && blocked;
			if (
				state.time >= duration + (pauses[state.phase] ?? 0) / pace &&
				!state.waiting
			)
				next();
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
		blink: createBlink(id * 0.9),
		left: arm(root, `${prefix}_left`, 0.32, -1),
		right: arm(root, `${prefix}_right`, 0.32, 1),
		feet: ["left", "right"].map((side) => ({
			leg: createLeg(
				required(root, `${prefix}_${side}_thigh`),
				required(root, `${prefix}_${side}_shin`),
				required(root, `${prefix}_${side}_foot`),
			),
			step: createFootstep(),
		})),
		gaze: createGaze(head, 0.42, 0.28),
		previousPosition: travel.position.clone(),
		gait: 0,
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
	const jjTravel = required(root, "barista_travel");
	const jjBody = required(root, "barista_body");
	const jjGaze = createGaze(jjHead, 0.55, 0.38);
	const cup = required(root, "service_cup");
	const milk = required(root, "service_milk");
	const tray = required(root, "service_tray");
	const cookie = required(root, "service_cookie");
	const stream = required(root, "service_stream");
	const milkHeight = milk.position.y;
	// Creamery's GLB root is identity. These Props have independent world paths.
	root.attach(cup);
	root.attach(tray);
	root.attach(cookie);
	const cupHome = new Vector3(-0.62, 1.31, 1.055);
	const trayHome = new Vector3(-1.18, 1.31, 1.04);
	const cupDock = new Vector3(-1.85, 1.175, 0.3);
	const trayDock = new Vector3(-1.08, 1.12, 0.16);
	const cupCarry = new Vector3();
	const trayCarry = new Vector3();
	const rightIdle = new Vector3();
	const leftIdle = new Vector3();
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
	const footTarget = new Vector3();
	const velocity = new Vector3();
	const pole = new Vector3();
	const attention = new Vector3();
	let priorPhase: Phase = "quiet";
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
			// JJ turns and steps along the back counter only after the order.
			const back =
				phase === "prepare"
					? smooth(t / 2) * (1 - smooth((t - 10) / 3))
					: phase === "clear"
						? smooth(t / 3) * (1 - smooth((t - 6) / 3))
						: 0;
			jjTravel.position.set(-0.9 - back * 0.4, 0, 0.55);
			jjTravel.rotation.set(0, back * Math.PI, 0);
			const working = ["prepare", "cup", "cookie", "return", "clear"].includes(
				phase,
			);
			const lean = working ? 0.055 * pulse(p) : 0;
			jjBody.rotation.x = still ? 0 : lean;
			jjBody.rotation.y = still
				? 0
				: -0.035 * pulse(p) * (phase === "cookie" ? -1 : 1);
			jjTravel.updateWorldMatrix(true, true);
			jjTravel.localToWorld(rightIdle.set(0.3, 0.78, 0.1));
			jjTravel.localToWorld(leftIdle.set(-0.3, 0.78, 0.1));
			jjTravel.localToWorld(cupCarry.set(0.28, 1.31, 0.505));
			jjTravel.localToWorld(trayCarry.set(-0.28, 1.31, 0.49));
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
				seated === 1 ? 0 : -0.055 * (1 - seated),
				z,
			);
			customer.travel.rotation.set(0, yaw, 0);
			velocity
				.subVectors(customer.travel.position, customer.previousPosition)
				.setY(0);
			if (priorPhase === "quiet" || still) {
				velocity.set(0, 0, 0);
				for (const foot of customer.feet) foot.step.reset();
			}
			customer.gait += velocity.length() * 14;
			customer.previousPosition.copy(customer.travel.position);
			if (dt > 0) velocity.divideScalar(dt);
			velocity.clampLength(0, 0.8);
			walk = Math.min(1, velocity.length() / SPEED);
			customer.travel.position.y += 0.006 * Math.sin(customer.gait) ** 2 * walk;
			// Lean forward over the support feet before sitting or rising.
			const shift = phase === "sit" || phase === "stand" ? pulse(p) * 0.19 : 0;
			const settle = phase === "enjoy" ? detail * pulse((t - 10) / 3.5) : 0;
			customer.body.rotation.set(
				shift + 0.025 * seated + 0.015 * walk,
				detail * 0.015 * Math.sin(customer.gait) * walk,
				settle * (state.variant ? -0.025 : 0.025) +
					detail * 0.012 * Math.sin(customer.gait) * walk,
			);
			customer.head.rotation.z = 0;
			customer.eyes.scale.y = customer.blink(dt, !!detail);
			customer.travel.updateWorldMatrix(true, true);
			orientation.copy(customer.travel.quaternion);
			pole.set(0, 0, 1).applyQuaternion(orientation);
			customer.feet.forEach(({ leg, step }, i) => {
				footTarget.set(i === 0 ? -0.087 : 0.087, 0, 0);
				customer.travel
					.localToWorld(footTarget)
					.addScaledVector(velocity, 0.36);
				footTarget.y = 0.1;
				step.update(
					dt,
					footTarget,
					orientation,
					!customer.feet[1 - i].step.swinging,
					walk > 0.5 ? 0.24 : 0.07,
					walk > 0.5 ? 0.3 : 0.26,
					0.065,
				);
				footTarget.set(i === 0 ? -0.087 : 0.087, 0.322, 0.16);
				customer.travel.localToWorld(footTarget);
				const liftToRing = ease(
					MathUtils.clamp((seated - i * 0.08) / (1 - i * 0.08), 0, 1),
				);
				footTarget.lerpVectors(step.target, footTarget, liftToRing);
				footTarget.y += Math.sin(Math.PI * liftToRing) * 0.055;
				tilt.slerpQuaternions(step.rotation, orientation, liftToRing);
				leg.solve(footTarget, tilt, pole);
			});
			// Relaxed hands beside the hips, forward over the knees when seated.
			left.set(-0.23, 0.5 + seated * 0.49, 0.03 + seated * 0.23);
			right.set(0.23, 0.5 + seated * 0.49, 0.03 + seated * 0.23);
			left.z += Math.sin(customer.gait) * walk * 0.065;
			right.z -= Math.sin(customer.gait) * walk * 0.065;
			customer.travel.localToWorld(left);
			customer.travel.localToWorld(right);
			if (seated < 0.2) {
				attention.set(0, 1.2, 3);
				customer.travel.localToWorld(attention);
			} else if (["cup", "cookie", "enjoy", "return"].includes(phase)) {
				attention.copy(phase === "cookie" ? trayMeet : cupRest);
				if (phase === "enjoy" && t > 9) jjHead.getWorldPosition(attention);
			} else jjHead.getWorldPosition(attention);
			customer.gaze(attention, dt, enabled);
			customer.head.localToWorld(mouth.set(0, 0.085, 0.15));
			jjRight.copy(rightIdle);
			jjLeft.copy(leftIdle);
			cupTarget.copy(cupDock);
			trayTarget.copy(trayDock);
			let jjHoldsCup = false;
			let jjHoldsTray = false;
			let customerCup = false;
			let customerCookie = false;
			let sip = 0;
			let bite = 0;
			cookie.visible = true;
			cookie.scale.setScalar(1);
			milk.visible = false;
			milk.position.y = milkHeight;
			stream.visible = false;
			if (phase === "prepare") {
				jjRight.lerp(cupDock, smooth((t - 2) / 2));
				jjRight.y += 0.04 * pulse((t - 2) / 2);
				wave.copy(trayDock).y -= TRAY_SUPPORT_HEIGHT;
				jjLeft.lerp(wave, smooth((t - 2) / 2));
				jjHoldsCup = jjHoldsTray = t >= 4;
				if (jjHoldsTray) {
					trayTarget.lerp(trayCarry, smooth(t - 4));
					jjLeft.copy(trayTarget).y -= TRAY_SUPPORT_HEIGHT;
				}
				if (jjHoldsCup) {
					cupTarget.lerp(cupCarry, smooth((t - 8) / 2));
					jjRight.copy(cupTarget);
				}
				const fill = smooth((t - 5) / 3);
				stream.visible = t >= 5 && t < 8;
				milk.visible = t >= 5;
				milk.position.y = milkHeight - (1 - fill) * 0.08;
			}
			if (["cup", "cookie", "enjoy", "return", "clear"].includes(phase)) {
				jjHoldsTray = !still;
				trayTarget.copy(still ? trayDock : trayHome);
				if (jjHoldsTray) jjLeft.copy(trayTarget).y -= TRAY_SUPPORT_HEIGHT;
				milk.visible = true;
			}
			if (phase === "greet" || phase === "goodbye") {
				const greeting = pulse(p);
				wave.set(0.28, state.variant === 0 ? 1.27 : 1.1, 0.18);
				customer.travel.localToWorld(wave);
				right.lerp(wave, greeting);
				customer.head.rotation.x +=
					greeting * (state.variant === 0 ? 0.07 : 0.2);
			}
			if (phase === "cup") {
				jjHoldsCup = true;
				jjRight.copy(cupHome);
				const reach = smooth(p / 0.5);
				jjRight.lerp(cupMeet, reach);
				left.lerp(cupMeet, reach);
				jjRight.y += 0.025 * pulse(p / 0.5);
				left.y += 0.015 * pulse(p / 0.5);
				cupTarget.copy(jjRight);
				if (p >= 0.5) {
					customerCup = true;
					cupTarget.lerpVectors(cupMeet, cupRest, smooth((p - 0.5) / 0.5));
					left.copy(cupTarget);
					jjRight.lerp(rightIdle, smooth((p - 0.5) / 0.5));
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
				bite = still
					? 0
					: smooth((t - 7.2) / 1.8) * (1 - smooth((t - 10.8) / 1.8));
				// Bring the near lip to the mouth, keeping the vessel below it.
				tilt.setFromAxisAngle(xAxis, sip * 0.7);
				wave.set(0, 0.068, 0.047).applyQuaternion(tilt);
				wave.subVectors(mouth, wave);
				cupTarget.lerp(wave, sip);
				// Finish eating at the mouth before withdrawing the empty hand.
				cookie.scale.setScalar(still ? 1 : 1 - smooth((t - 9.4) / 1.4));
				wave.copy(mouth).z -= 0.043 * cookie.scale.x;
				cookieTarget.copy(cookieRest).lerp(wave, bite);
				left.copy(cupTarget);
				right.copy(cookieTarget);
				milk.visible = still || eating < 1.6;
				customer.head.rotation.z = detail * pulse((t - 12.6) / 1.8) * 0.1;
			}
			if (phase === "return") {
				milk.visible = cookie.visible = false;
				const reach = smooth(p / 0.5);
				cupTarget.lerp(cupMeet, reach);
				left.copy(cupTarget);
				jjRight.lerp(cupMeet, reach);
				if (p >= 0.5) {
					customerCup = false;
					jjHoldsCup = true;
					cupTarget.lerpVectors(cupMeet, cupHome, smooth((p - 0.5) / 0.5));
					jjRight.copy(cupTarget);
					left.lerp(cupRest, smooth((p - 0.5) / 0.5));
				}
			}
			if (phase === "clear") {
				cupTarget.copy(cupCarry).lerp(cupDock, smooth((t - 3) / 2));
				trayTarget.copy(trayCarry).lerp(trayDock, smooth((t - 3) / 2));
				jjRight.copy(cupTarget).lerp(rightIdle, smooth(t - 5));
				jjLeft.copy(trayTarget).y -= TRAY_SUPPORT_HEIGHT;
				jjLeft.lerp(leftIdle, smooth(t - 5));
				jjHoldsCup = jjHoldsTray = t < 5;
			}
			if (["clear", "goodbye", "stand", "leave"].includes(phase)) {
				milk.visible = cookie.visible = false;
			}
			if (phase === "cookie") jjLeft.copy(trayTarget).y -= TRAY_SUPPORT_HEIGHT;
			// Opposed grippers share the vessel at separate heights. Blend the
			// contact offsets on approach/release as well as while carrying it.
			const transfer = smooth((p - 0.5) / 0.5);
			const jjGrip =
				phase === "prepare"
					? smooth((t - 2) / 2)
					: phase === "cup"
						? 1 - transfer
						: phase === "return"
							? smooth(p / 0.5)
							: phase === "clear"
								? 1 - smooth(t - 5)
								: 0;
			const customerGrip =
				phase === "cup"
					? smooth(p / 0.5)
					: phase === "return"
						? 1 - transfer
						: customerCup
							? 1
							: 0;
			jjRight.y -= CUP_GRIP_HEIGHT * jjGrip;
			tilt.setFromAxisAngle(xAxis, sip * 0.7);
			wave.set(0, CUP_GRIP_HEIGHT * customerGrip, 0).applyQuaternion(tilt);
			left.add(wave);
			jjCup.hand.scale.x = MathUtils.lerp(1, 0.98, jjGrip);
			customer.left.hand.scale.x = MathUtils.lerp(1, 1.03, customerGrip);
			customer.right.hand.scale.x = MathUtils.lerp(
				1,
				0.86 * Math.max(0.3, cookie.scale.x),
				phase === "cookie"
					? smooth(p / 0.5)
					: customerCookie
						? still
							? 1
							: 1 - smooth((t - 10.8) / 1.8)
						: 0,
			);
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
			if (customerCup || jjHoldsCup) {
				(customerCup ? customer.left.hand : jjCup.hand).getWorldPosition(
					cupTarget,
				);
				if (customerCup) cupTarget.sub(wave);
				else cupTarget.y += CUP_GRIP_HEIGHT * jjGrip;
			}
			// Keep the label's orientation through both handoffs. Only the sip
			// tips the vessel; changing owners must not spin it half a turn.
			place(cup, cupTarget);
			cup.rotation.x = sip * 0.7;
			if (jjHoldsTray)
				jjTray.hand.getWorldPosition(trayTarget).y += TRAY_SUPPORT_HEIGHT;
			place(tray, trayTarget);
			if (customerCookie) customer.right.hand.getWorldPosition(cookieTarget);
			else cookieTarget.copy(trayTarget).add(wave.set(0.045, 0.03, 0));
			place(cookie, cookieTarget);
			// Attention leads the task: JJ looks to the dock before reaching,
			// then follows the shared cup/tray or the customer's face.
			if (phase === "prepare" || phase === "clear") attention.copy(cupTarget);
			else if (phase === "cup" || phase === "return") attention.copy(cupMeet);
			else if (phase === "cookie") attention.copy(trayMeet);
			else if (phase !== "quiet") customer.head.getWorldPosition(attention);
			else if (clock < 3) attention.set(0, 3.4, 14);
			else {
				const activeCat = cats.find(
					(cat) => !cat.resting && cat.position && cat.position.y > 0.8,
				);
				if (activeCat?.position) attention.copy(activeCat.position).y += 0.2;
				else jjTravel.localToWorld(attention.set(0, 1.7, 3));
			}
			jjGaze(attention, dt, enabled);
			if (phase === "greet" || phase === "goodbye")
				jjHead.rotation.x += pulse(p) * 0.07;
			priorPhase = phase;
			return state;
		},
	};
}
