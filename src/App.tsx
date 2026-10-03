import { useEffect, useState } from "react";
import { Sections } from "./content/Sections";
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

	useEffect(() => {
		if (station !== "street") setHintSeen(true);
	}, [station]);

	if (!webgl) {
		return (
			<Sections current={station} plain onClose={() => setStation("street")} />
		);
	}

	return (
		<>
			<Scene
				station={stationById(station)}
				onStation={setStation}
				motion={!reducedMotion}
			/>
			{!entered && <Loader onEnter={() => setEntered(true)} />}
			{entered && (
				<>
					<StationMenu current={station} onSelect={setStation} />
					{!hintSeen && station === "street" && (
						<p className="hint pixel" role="status">
							Click the glowing objects to look around
						</p>
					)}
					<Sections current={station} onClose={() => setStation("street")} />
				</>
			)}
		</>
	);
}
