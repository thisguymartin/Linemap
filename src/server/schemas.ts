import { z } from 'zod';
import { EXCALIDRAW_ELEMENT_TYPES, type ExcalidrawElementType } from '../types.js';

const elementTypes = Object.values(EXCALIDRAW_ELEMENT_TYPES) as [ExcalidrawElementType, ...ExcalidrawElementType[]];

const binding = z.object({
  elementId: z.string(),
  focus: z.number().optional(),
  gap: z.number().optional(),
  fixedPoint: z.tuple([z.number(), z.number()]).nullable().optional(),
  mode: z.string().optional()
}).nullable().optional();

const boundElements = z.array(z.object({
  id: z.string(),
  type: z.enum(['arrow', 'text'])
})).nullable().optional();

// Loose objects on purpose: unknown Excalidraw properties (containerId,
// textAlign, customData, ...) must pass through the server untouched.
const sharedFields = {
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  backgroundColor: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().optional(),
  strokeStyle: z.string().optional(),
  roughness: z.number().optional(),
  opacity: z.number().optional(),
  text: z.string().optional(),
  label: z.object({ text: z.string() }).optional(),
  fontSize: z.number().optional(),
  fontFamily: z.union([z.string(), z.number()]).optional(),
  containerId: z.string().nullable().optional(),
  index: z.string().nullable().optional(),
  seed: z.number().optional(),
  versionNonce: z.number().optional(),
  updated: z.number().optional(),
  groupIds: z.array(z.string()).optional(),
  locked: z.boolean().optional(),
  roundness: z.object({ type: z.number(), value: z.number().optional() }).nullable().optional(),
  fillStyle: z.string().optional(),
  customData: z.record(z.string(), z.unknown()).nullable().optional(),
  link: z.string().nullable().optional(),
  start: z.object({ id: z.string() }).optional(),
  end: z.object({ id: z.string() }).optional(),
  startArrowhead: z.string().nullable().optional(),
  endArrowhead: z.string().nullable().optional(),
  elbowed: z.boolean().optional(),
  startBinding: binding,
  endBinding: binding,
  boundElements,
  fileId: z.string().optional(),
  status: z.string().optional(),
  scale: z.tuple([z.number(), z.number()]).optional()
};

export const CreateElementSchema = z.looseObject({
  ...sharedFields,
  id: z.string().optional(),
  type: z.enum(elementTypes),
  x: z.number(),
  y: z.number(),
  points: z.any().optional()
});

export const UpdateElementSchema = z.looseObject({
  ...sharedFields,
  id: z.string(),
  type: z.enum(elementTypes).optional(),
  originalText: z.string().optional(),
  points: z.array(z.union([
    z.tuple([z.number(), z.number()]),
    z.object({ x: z.number(), y: z.number() })
  ])).optional()
});

export type CreateElementInput = z.infer<typeof CreateElementSchema>;
export type UpdateElementInput = z.infer<typeof UpdateElementSchema>;
