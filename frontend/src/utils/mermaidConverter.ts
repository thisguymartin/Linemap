import { parseMermaidToExcalidraw, type MermaidConfig } from '@excalidraw/mermaid-to-excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { BinaryFiles } from '@excalidraw/excalidraw/types';

export interface MermaidConversionResult {
  elements: readonly ExcalidrawElement[];
  files?: BinaryFiles;
  error?: string;
}

// Runs in the browser: mermaid needs a DOM to lay the diagram out.
export const convertMermaidToExcalidraw = async (
  mermaidDefinition: string,
  config?: MermaidConfig
): Promise<MermaidConversionResult> => {
  try {
    const result = await parseMermaidToExcalidraw(mermaidDefinition, config);
    return { elements: result.elements, files: result.files };
  } catch (error) {
    console.error('Error converting Mermaid to Excalidraw:', error);
    return { elements: [], error: error instanceof Error ? error.message : String(error) };
  }
};

// Only the keys mermaid-to-excalidraw 3.x understands; the server passes
// whatever the caller sent, so unknown keys are dropped here.
export const normalizeMermaidConfig = (raw: unknown): MermaidConfig => {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const flowchart = input.flowchart as { curve?: string } | undefined;
  const themeVariables = input.themeVariables as { fontSize?: string } | undefined;
  return {
    flowchart: { curve: flowchart?.curve === 'basis' ? 'basis' : 'linear' },
    themeVariables: { fontSize: typeof themeVariables?.fontSize === 'string' ? themeVariables.fontSize : '20px' },
    maxEdges: typeof input.maxEdges === 'number' ? input.maxEdges : 500,
    maxTextSize: typeof input.maxTextSize === 'number' ? input.maxTextSize : 50000
  };
};

export const DEFAULT_MERMAID_CONFIG: MermaidConfig = normalizeMermaidConfig({});
