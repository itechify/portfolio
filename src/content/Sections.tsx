import type { ReactNode } from "react";
import type { SectionId, StationId } from "../stations";

interface SectionDef {
	id: SectionId;
	title: string;
	body: ReactNode;
}

const REPO = "https://github.com/itechify/portfolio";

/** Placeholder content. Replace the bodies; keep the ids, they match STATIONS. */
export const SECTIONS: readonly SectionDef[] = [
	{
		id: "about",
		title: "About",
		body: (
			<>
				<p>
					<strong>Placeholder.</strong> Hi, I'm Jeffrey Davis. A short bio goes
					here: what I build, what I care about, and what I'm looking at next.
				</p>
			</>
		),
	},
	{
		id: "projects",
		title: "Projects",
		body: (
			<ul className="cards">
				<li>
					<h3>JJ's Creamery</h3>
					<p>
						This site. An immersive 3D portfolio built from a scripted Blender
						model with baked lighting, rendered with React Three Fiber.
					</p>
					<p className="tags">
						Three.js · React Three Fiber · Blender · TypeScript · Cloudflare
					</p>
					<a href={REPO}>Source on GitHub</a>
				</li>
			</ul>
		),
	},
	{
		id: "resume",
		title: "Resume",
		body: (
			<p>
				<strong>Placeholder.</strong> A resume PDF will be linked here for
				download.
			</p>
		),
	},
	{
		id: "contact",
		title: "Contact",
		body: (
			<ul>
				<li>
					<a href="https://github.com/itechify">GitHub</a>
				</li>
				<li>LinkedIn: placeholder</li>
				<li>Email: placeholder</li>
			</ul>
		),
	},
	{
		id: "credits",
		title: "Credits",
		body: (
			<ul>
				<li>
					Concept inspired by{" "}
					<a href="https://www.jessezhou.com/">Jesse Zhou's "Jesse's Ramen"</a>.
				</li>
				<li>
					Shop design inspired by the pixel art of{" "}
					<a href="https://www.youtube.com/@BJGPixel">
						Brandon James Greer (BJGPixel)
					</a>
					.
				</li>
				<li>Built with Three.js, React Three Fiber, drei, and Blender.</li>
				<li>Music and sound: to be credited when added.</li>
				<li>
					TV videos and their audio:{" "}
					<a href="https://www.youtube.com/@BetaByJ/shorts">
						BetaByJ (Jeffrey Davis)
					</a>
					, played through YouTube.
				</li>
				<li>TV idle bouldering image: generated with OpenAI.</li>
			</ul>
		),
	},
];

interface Props {
	current: StationId;
	/** When true, render every Section visibly as a plain page (no WebGL). */
	plain?: boolean;
	onClose: () => void;
}

/**
 * All Section content is always in the document so crawlers and screen readers
 * get the whole site; only the active Station's Section is visible (ADR 0002).
 */
export function Sections({ current, plain = false, onClose }: Props) {
	return (
		<main className={plain ? "sections plain" : "sections"}>
			{SECTIONS.map((s) => {
				const active = plain || s.id === current;
				return (
					<section
						key={s.id}
						id={s.id}
						className={active ? "section" : "section section--inactive"}
						aria-hidden={active ? undefined : true}
						inert={!active}
					>
						<h2 className="pixel">{s.title}</h2>
						{s.body}
						{!plain && (
							<button type="button" className="pixel close" onClick={onClose}>
								Back to the street
							</button>
						)}
					</section>
				);
			})}
		</main>
	);
}
