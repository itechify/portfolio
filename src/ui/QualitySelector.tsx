import type { QualityChoice, QualityTier } from "../scene/quality";

export function QualitySelector({
	choice,
	tier,
	onChange,
}: {
	choice: QualityChoice;
	tier: QualityTier;
	onChange: (choice: QualityChoice) => void;
}) {
	return (
		<label className="quality-selector">
			Quality Tier
			<select
				value={choice}
				onChange={(e) => onChange(e.target.value as QualityChoice)}
			>
				<option value="auto">Auto ({tier})</option>
				<option value="full">Full</option>
				<option value="balanced">Balanced</option>
				<option value="light">Light</option>
			</select>
		</label>
	);
}
