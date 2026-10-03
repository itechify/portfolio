import { STATIONS, type StationId } from "../stations";

interface Props {
	current: StationId;
	onSelect: (id: StationId) => void;
}

/** The always-visible Station Menu: the keyboard route to every Section. */
export function StationMenu({ current, onSelect }: Props) {
	return (
		<nav className="station-menu" aria-label="Stations">
			<ul>
				{STATIONS.map((s) => (
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
