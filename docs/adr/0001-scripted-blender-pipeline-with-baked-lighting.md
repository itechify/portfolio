---
status: accepted
---

# Scripted Blender pipeline with lighting baked into textures

The Creamery is modeled in Blender by a Python build script that constructs every mesh, material, and light, ray-traces the lighting with Cycles, bakes it into textures, and exports a GLB for the web. Nothing in the model is hand-edited. The web scene then renders those textures unlit, apart from emissive neon and screens, so the browser pays almost nothing for a look that was ray-traced.

## Considered Options

- **Hand modeling in the Blender UI** was rejected because the model is built by an AI agent working through scripts, and a hand-edited .blend file can't be reviewed, diffed, or rebuilt from a description. The agent reviews rendered images instead and changes the script.
- **Real-time lighting in Three.js** was rejected because soft shadows, bounce light, and neon glow at phone frame rates are not achievable without baking. Jesse Zhou's ramen shop, the model for this site, reached its look the same way.

## Consequences

- There is a Python script in a React repository, in the `blender` folder, and a single command rebuilds the model from scratch. The generated .blend file is not committed.
- Every lighting change is a full rebake, so lighting iterations are slow and should be batched.
- The headless pipeline renders on the GPU through OptiX, so it runs even when the Blender window itself is unusable, as it is over Remote Desktop.
