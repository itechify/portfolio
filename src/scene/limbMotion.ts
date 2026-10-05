import { MathUtils, type Object3D, Quaternion, Vector3 } from "three";

export const ease = (value: number) => {
	const t = MathUtils.clamp(value, 0, 1);
	return t * t * t * (t * (t * 6 - 15) + 10);
};

/** Irregular, reproducible blink intervals, sampled only between blinks. */
export function createBlink(seed: number) {
	let elapsed = 0;
	let count = 0;
	let wait = 2.5 + seed;
	return (dt: number, enabled = true) => {
		if (!enabled) {
			elapsed = count = 0;
			wait = 2.5 + seed;
			return 1;
		}
		elapsed += dt;
		if (elapsed < wait) return 1;
		const phase = (elapsed - wait) / 0.23;
		if (phase >= 1) {
			elapsed = 0;
			wait = 3.2 + ((++count * 0.61803398875 + seed * 0.31) % 1) * 4.8;
			return 1;
		}
		return 1 - 0.94 * Math.sin(Math.PI * phase) ** 2;
	};
}

/** A rigid two-bone leg. Solve in world space so a planted foot survives
 * root translation, turns and weight shifts without stretching its bones. */
export function createLeg(upper: Object3D, lower: Object3D, foot: Object3D) {
	const a = lower.position.length();
	const b = foot.position.length();
	const upperAxis = lower.position.clone().normalize();
	const lowerAxis = foot.position.clone().normalize();
	const origin = new Vector3();
	const direction = new Vector3();
	const bend = new Vector3();
	const knee = new Vector3();
	const end = new Vector3();
	const q = new Quaternion();
	const parent = new Quaternion();
	function orient(object: Object3D, axis: Vector3, toward: Vector3) {
		q.setFromUnitVectors(axis, toward.normalize());
		object.parent?.getWorldQuaternion(parent);
		object.quaternion.copy(parent.invert()).multiply(q);
		object.updateWorldMatrix(false, false);
	}
	return {
		foot,
		solve(target: Vector3, orientation: Quaternion, pole: Vector3) {
			upper.getWorldPosition(origin);
			direction.subVectors(target, origin);
			const distance = MathUtils.clamp(
				direction.length(),
				Math.abs(a - b) + 0.00001,
				a + b - 0.00001,
			);
			direction.normalize();
			end.copy(origin).addScaledVector(direction, distance);
			bend
				.copy(pole)
				.addScaledVector(direction, -pole.dot(direction))
				.normalize();
			const along = (a * a - b * b + distance * distance) / (2 * distance);
			knee
				.copy(origin)
				.addScaledVector(direction, along)
				.addScaledVector(bend, Math.sqrt(Math.max(0, a * a - along * along)));
			orient(upper, upperAxis, bend.subVectors(knee, origin));
			orient(lower, lowerAxis, bend.subVectors(end, knee));
			lower.getWorldQuaternion(parent);
			foot.quaternion.copy(parent.invert()).multiply(orientation);
			foot.updateWorldMatrix(false, false);
		},
	};
}

/** Stance is an actual world-space anchor. Only a lifted foot can relocate.
 * Callers alternate feet/pairs; no random sampling or allocations per frame. */
export function createFootstep() {
	const planted = new Vector3();
	const from = new Vector3();
	const to = new Vector3();
	const target = new Vector3();
	const rotation = new Quaternion();
	const fromRotation = new Quaternion();
	const toRotation = new Quaternion();
	let initialized = false;
	let progress = 1;
	return {
		target,
		rotation,
		get swinging() {
			return progress < 1;
		},
		reset() {
			initialized = false;
			progress = 1;
		},
		update(
			dt: number,
			desired: Vector3,
			orientation: Quaternion,
			canStep: boolean,
			stride: number,
			duration: number,
			lift: number,
		) {
			if (!initialized) {
				planted.copy(desired);
				rotation.copy(orientation);
				initialized = true;
			}
			if (
				progress >= 1 &&
				canStep &&
				(planted.distanceTo(desired) > stride ||
					rotation.angleTo(orientation) > 0.3)
			) {
				from.copy(planted);
				to.copy(desired);
				fromRotation.copy(rotation);
				toRotation.copy(orientation);
				progress = 0;
			}
			if (progress < 1) {
				progress = Math.min(1, progress + dt / duration);
				target.lerpVectors(from, to, ease(progress));
				target.y += lift * Math.sin(Math.PI * progress) ** 2;
				rotation.slerpQuaternions(fromRotation, toRotation, ease(progress));
				if (progress === 1) planted.copy(to);
			} else target.copy(planted);
			return target;
		},
	};
}

/** Look at a real activity in the parent's coordinates, with joint limits. */
export function createGaze(
	head: Object3D,
	yawLimit: number,
	pitchLimit: number,
) {
	const local = new Vector3();
	let lookingYaw = 0;
	let lookingPitch = 0;
	return (target: Vector3, dt: number, enabled = true) => {
		local.copy(target);
		head.parent?.worldToLocal(local);
		local.sub(head.position);
		const yaw = MathUtils.clamp(
			Math.atan2(local.x, local.z),
			-yawLimit,
			yawLimit,
		);
		const pitch = MathUtils.clamp(
			-Math.atan2(local.y, Math.hypot(local.x, local.z)),
			-pitchLimit,
			pitchLimit,
		);
		lookingYaw = enabled ? MathUtils.damp(lookingYaw, yaw, 7, dt) : 0;
		lookingPitch = enabled ? MathUtils.damp(lookingPitch, pitch, 7, dt) : 0;
		head.rotation.y = lookingYaw;
		head.rotation.x = lookingPitch;
	};
}
