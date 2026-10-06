import { useCallback, useEffect, useRef, useState } from "react";
import { Sections } from "./content/Sections";
import { ShortsSection } from "./content/ShortsSection";
import type { QualityChoice, QualityTier } from "./scene/quality";
import { Scene } from "./scene/Scene";
import { type StationId, stationById } from "./stations";
import { Loader } from "./ui/Loader";
import { QualitySelector } from "./ui/QualitySelector";
import { StationMenu } from "./ui/StationMenu";

function useMediaQuery(query: string) {
	const [matches, setMatches] = useState(
		() => window.matchMedia(query).matches,
	);
	useEffect(() => {
		const mq = window.matchMedia(query);
		const onChange = () => setMatches(mq.matches);
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, [query]);
	return matches;
}

function hasWebGL() {
	try {
		const canvas = document.createElement("canvas");
		return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
	} catch {
		return false;
	}
}

export function App() {
	const [entered, setEntered] = useState(false);
	const [station, setStation] = useState<StationId>("street");
	const [tvHovered, setTvHovered] = useState(false);
	const [qualityChoice, setQualityChoice] = useState<QualityChoice>(() => {
		try {
			const stored = localStorage.getItem("creamery-quality");
			if (stored === "full" || stored === "balanced" || stored === "light")
				return stored;
		} catch {
			/* Storage is optional. */
		}
		return "auto";
	});
	const [autoQuality, setAutoQuality] = useState<QualityTier>(() =>
		window.matchMedia("(pointer: coarse)").matches ? "balanced" : "full",
	);
	const quality = qualityChoice === "auto" ? autoQuality : qualityChoice;
	const chooseQuality = (choice: QualityChoice) => {
		setQualityChoice(choice);
		if (choice === "auto") setAutoQuality("full");
		try {
			localStorage.setItem("creamery-quality", choice);
		} catch {
			/* Storage is optional. */
		}
	};
	const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
	const [webgl] = useState(hasWebGL);
	const narrow = useMediaQuery("(max-width: 900px), (max-height: 680px)");
	const surface = useRef<HTMLDivElement>(null);
	const aboutSurface = useRef<HTMLElement>(null);
	const [aboutReady, setAboutReady] = useState(false);
	const hotspot = useRef<HTMLButtonElement>(null);
	const previous = useRef<StationId>("street");
	const lastStation = useRef<StationId>("street");
	const [screenReady, setScreenReady] = useState(false);
	const selectStation = (id: StationId) => {
		if (id === "shorts" && station !== "shorts") previous.current = station;
		setStation(id);
	};
	const closeTv = useCallback(() => {
		setStation(previous.current);
		requestAnimationFrame(() =>
			hotspot.current?.focus({ preventScroll: true }),
		);
	}, []);
	useEffect(() => {
		if (station === "street" && lastStation.current !== "street") {
			document
				.getElementById(`station-${lastStation.current}`)
				?.focus({ preventScroll: true });
		}
		lastStation.current = station;
	}, [station]);
	useEffect(() => {
		if (station === "street") return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (station === "shorts") closeTv();
			else setStation("street");
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [station, closeTv]);
	const shorts = (
		<ShortsSection
			active={station === "shorts"}
			plain={!webgl}
			narrow={narrow}
			screenReady={screenReady}
			reducedMotion={reducedMotion}
			surface={surface}
			onClose={closeTv}
			onOpen={() => selectStation("shorts")}
		/>
	);

	if (!webgl) {
		return (
			<div className="plain-content">
				<Sections
					current={station}
					plain
					onClose={() => setStation("street")}
				/>
				{shorts}
			</div>
		);
	}

	return (
		<>
			<Scene
				station={stationById(station)}
				onStation={selectStation}
				motion={entered && !reducedMotion}
				tvHovered={tvHovered}
				quality={quality}
				about={{
					surface: aboutSurface,
					active: entered && station === "about",
					narrow,
					onReady: setAboutReady,
				}}
				onLowerQuality={
					entered && qualityChoice === "auto" && station === "street"
						? setAutoQuality
						: undefined
				}
				tv={{
					surface,
					hotspot,
					active: station === "shorts",
					narrow,
					onReady: setScreenReady,
				}}
			/>
			{!entered && <Loader onEnter={() => setEntered(true)} />}
			<Sections
				current={entered ? station : "street"}
				onClose={() => setStation("street")}
				aboutSurface={aboutSurface}
				aboutReady={aboutReady}
				narrow={narrow}
			/>
			{entered && (
				<>
					<StationMenu current={station} onSelect={selectStation} />
					{station === "street" && (
						<QualitySelector
							choice={qualityChoice}
							tier={quality}
							onChange={chooseQuality}
						/>
					)}
					<button
						ref={hotspot}
						className="tv-hotspot"
						type="button"
						aria-label="Watch BetaByJ Shorts on the TV"
						aria-controls="shorts"
						disabled={station === "shorts"}
						onPointerEnter={() => setTvHovered(true)}
						onPointerLeave={() => setTvHovered(false)}
						onClick={() => selectStation("shorts")}
					>
						<span className="sr-only">Watch BetaByJ Shorts on the TV</span>
					</button>
					{shorts}
				</>
			)}
		</>
	);
}
