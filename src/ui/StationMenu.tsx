import { useLayoutEffect, useRef } from "react";
import { STATIONS, type StationId } from "../stations";

interface Props {
	current: StationId;
	onSelect: (id: StationId) => void;
}

/** The Station Menu omits discovery-only Stations, which have DOM Hotspots. */
export function StationMenu({ current, onSelect }: Props) {
	const menu = useRef<HTMLElement>(null);
	useLayoutEffect(() => {
		const element = menu.current;
		const container = element?.parentElement;
		if (!element || !container) return;
		// The menu wraps on phones and with enlarged text. Keep panels above
		// its actual height so their close controls remain unobstructed.
		const measure = () =>
			container.style.setProperty(
				"--station-menu-height",
				`${element.getBoundingClientRect().height}px`,
			);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => {
			observer.disconnect();
			container.style.removeProperty("--station-menu-height");
		};
	}, []);
	return (
		<nav ref={menu} className="station-menu" aria-label="Stations">
			<ul>
				{STATIONS.filter((s) => !s.hidden).map((s) => (
					<li key={s.id}>
						<button
							id={`station-${s.id}`}
							type="button"
							className="pixel"
							aria-current={s.id === current ? "location" : undefined}
							onClick={() => onSelect(s.id)}
						>
							{s.label}
						</button>
					</li>
				))}
			</ul>
		</nav>
	);
}
