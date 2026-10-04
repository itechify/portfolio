/** A Section is one body of portfolio content. See CONTEXT.md. */
export type SectionId =
	| "about"
	| "projects"
	| "resume"
	| "contact"
	| "credits"
	| "shorts";

/** A Station is a framed camera view. Street View is the default one. */
export type StationId = "street" | SectionId;

export interface Station {
	id: StationId;
	label: string;
	/** Name of the Hotspot mesh in the GLB that leads here. */
	hotspot: string;
	/** Camera distance in front of the Hotspot when framed. */
	distance: number;
	/** Discovery-only Stations have an accessible Hotspot instead of a menu entry. */
	hidden?: boolean;
}

export const STATIONS: readonly Station[] = [
	{
		id: "street",
		label: "Street View",
		hotspot: "hotspot_home_sign",
		distance: 18,
	},
	{
		id: "about",
		label: "About",
		hotspot: "hotspot_about_cowscreen",
		distance: 4.5,
	},
	{
		id: "projects",
		label: "Projects",
		hotspot: "hotspot_projects_machine",
		distance: 4,
	},
	{
		id: "resume",
		label: "Resume",
		hotspot: "hotspot_resume_kiosk",
		distance: 4,
	},
	{
		id: "contact",
		label: "Contact",
		hotspot: "hotspot_contact_board",
		distance: 3.5,
	},
	{
		id: "credits",
		label: "Credits",
		hotspot: "hotspot_credits_monitor",
		distance: 5,
	},
	{
		id: "shorts",
		label: "BetaByJ Shorts",
		hotspot: "hotspot_shorts_tv",
		distance: 3.3,
		hidden: true,
	},
];

export const stationByHotspot = (name: string): Station | undefined =>
	STATIONS.find((s) => s.hotspot === name);

export const stationById = (id: StationId): Station =>
	STATIONS.find((s) => s.id === id) ?? STATIONS[0];
