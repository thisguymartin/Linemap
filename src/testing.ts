// Bundle entry for the check scripts in scripts/: everything they reach into,
// from one module, so tests do not depend on how the build lays out dist/.
export { renderScene, RenderError } from './core/render/index.js';
export { expandElementsForExport } from './core/expand-elements.js';
export { prepareScene, renderSvgWithExcalidraw } from './core/render/excalidraw-node/index.js';
export { importScene } from './core/scene-io.js';
export { callExcalidrawTool } from './core/mcp-dispatch.js';
