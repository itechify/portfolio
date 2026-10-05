/** One car at a time, with a full quiet interval after every crossing.
 * Time only advances while the document is visible (the caller owns that).
 * Returning from a Section never queues a burst of missed arrivals.
 */
export function createTrafficMotion(random: () => number = Math.random) {
	const gap = () => 20 + Math.min(1, Math.max(0, random())) * 20;
	const state = { active: false, x: 0, distance: 0, variant: 0 };
	let waiting = gap();
	let end = 9;
	let speed = 3.6;
	return (delta: number, motion: boolean, street: boolean, extent = 9) => {
		if (!motion) {
			if (state.active) waiting = gap();
			state.active = false;
			return state;
		}
		// Avoid teleporting across the screen after a stalled frame.
		const dt = Math.min(Math.max(delta, 0), 0.1);
		if (state.active) {
			const step = dt * speed;
			state.x += step;
			state.distance += step;
			if (state.x > end) {
				state.active = false;
				waiting = gap();
			}
		} else if (street) {
			waiting -= dt;
			if (waiting <= 0) {
				end = Math.max(9, extent);
				state.x = -end;
				state.distance = 0;
				state.variant = Math.min(2, Math.floor(random() * 3));
				speed = 3.4 + random() * 0.6;
				state.active = true;
			}
		}
		return state;
	};
}
