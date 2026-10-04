import { STATIONS, type StationId } from "../stations";

interface Props {
	current: StationId;
	onSelect: (id: StationId) => void;
}

/** The Station Menu omits discovery-only Stations, which have DOM Hotspots. */
export function StationMenu({ current, onSelect }: Props) {
	return (
		<nav className="station-menu" aria-label="Stations">
			<ul>
				{STATIONS.filter((s) => !s.hidden).map((s) => (
					<li key={s.id}>
						<button
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
