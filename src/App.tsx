import { useCallback, useEffect, useRef, useState } from "react";
import { Sections } from "./content/Sections";
import { ShortsSection } from "./content/ShortsSection";
import { Scene } from "./scene/Scene";
import { type StationId, stationById } from "./stations";
import { Loader } from "./ui/Loader";
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
	const [hintSeen, setHintSeen] = useState(false);
	const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
	const [webgl] = useState(hasWebGL);
	const narrow = useMediaQuery("(max-width: 900px), (max-height: 680px)");
	const surface = useRef<HTMLDivElement>(null);
	const hotspot = useRef<HTMLButtonElement>(null);
	const previous = useRef<StationId>("street");
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
		if (station !== "shorts") return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") closeTv();
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

	useEffect(() => {
		if (station !== "street") setHintSeen(true);
	}, [station]);

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
				tv={{
					surface,
					hotspot,
					active: station === "shorts",
					narrow,
					onReady: setScreenReady,
				}}
			/>
			{!entered && <Loader onEnter={() => setEntered(true)} />}
			{entered && (
				<>
					<StationMenu current={station} onSelect={selectStation} />
					<button
						ref={hotspot}
						className="tv-hotspot"
						type="button"
						aria-label="Watch BetaByJ Shorts on the TV"
						aria-controls="shorts"
						disabled={station === "shorts"}
						onClick={() => selectStation("shorts")}
					>
						<span className="sr-only">Watch BetaByJ Shorts on the TV</span>
					</button>
					{!hintSeen && station === "street" && (
						<p className="hint pixel" role="status">
							Click the glowing objects to look around
						</p>
					)}
					<Sections current={station} onClose={() => setStation("street")} />
					{shorts}
				</>
			)}
		</>
	);
}
