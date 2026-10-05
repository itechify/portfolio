export type QualityTier = "full" | "balanced" | "light";
export type QualityChoice = "auto" | QualityTier;

export const QUALITY = {
	full: { dpr: 2, reflection: 512, bloom: true },
	balanced: { dpr: 1.25, reflection: 256, bloom: true },
	light: { dpr: 0.85, reflection: 0, bloom: false },
} as const;

/** Slow, one-way adaptation avoids cycling effects on and off mid-visit. */
export function createQualityMonitor() {
	let warmup = 3;
	let elapsed = 0;
	let frames = 0;
	return (delta: number, tier: QualityTier): QualityTier => {
		if (delta <= 0 || delta > 2) return tier;
		if (warmup > 0) {
			warmup -= delta;
			return tier;
		}
		elapsed += delta;
		frames++;
		if (elapsed < 4) return tier;
		const fps = frames / elapsed;
		elapsed = 0;
		frames = 0;
		warmup = 3;
		if (fps >= 43) return tier;
		return tier === "full" ? "balanced" : "light";
	};
}
