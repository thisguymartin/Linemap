import type { Tool } from '@modelcontextprotocol/server';

// Workspace tools: projects, diagrams, versions, notes, links and tags.
// Every drawing tool operates on the *active* diagram; these tools decide
// which diagram that is and keep the surrounding context (versions, notes,
// links) that lets an agent pick up a project cold.

const PROJECT_REF = { type: 'string', description: 'Project id, slug or name. Defaults to the project of the active diagram.' };
const DIAGRAM_REF = { type: 'string', description: 'Diagram id or name. Defaults to the diagram currently on the canvas.' };
const TAGS = { type: 'array', items: { type: 'string' }, description: 'Lowercase tags without the # (e.g. ["hvac", "safety"]).' };

export const workspaceTools: Tool[] = [
  {
    name: 'list_projects',
    description: 'List every project in the workspace with diagram, note and link counts. Start here when you do not know where you are.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'create_project',
    description: 'Create a project: one domain to think about (e.g. "Water Heater", "Order Pipeline"). Projects group diagrams, notes and links.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string', description: 'What this project is about. Shows up in get_project_context.' },
        tags: TAGS,
        color: { type: 'string', description: 'Accent colour as #rrggbb (optional).' },
        rootPath: { type: 'string', description: 'Absolute path (or ~/...) of the local folder or repo this project describes (optional).' }
      },
      required: ['name']
    }
  },
  {
    name: 'link_project_folder',
    description: 'Point a project at a local folder (usually the repo its diagrams describe). The project context then shows the folder, its git branch and top-level layout, and in-browser agents can read it. Pass an empty path to unlink.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT_REF,
        path: { type: 'string', description: 'Absolute path or ~/path to an existing folder; empty string unlinks.' }
      },
      required: ['path']
    }
  },
  {
    name: 'get_project',
    description: 'Project details: description, tags, its diagrams (with version state) and the links between them.',
    inputSchema: { type: 'object', properties: { project: PROJECT_REF } }
  },
  {
    name: 'update_project',
    description: 'Rename a project or change its description, tags or colour.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT_REF,
        name: { type: 'string' },
        description: { type: 'string' },
        tags: TAGS,
        color: { type: 'string' }
      }
    }
  },
  {
    name: 'delete_project',
    description: 'Delete a project and every diagram, version, note and link in it. Irreversible; requires confirm: true.',
    inputSchema: {
      type: 'object',
      properties: { project: PROJECT_REF, confirm: { type: 'boolean', description: 'Must be true.' } },
      required: ['project', 'confirm']
    }
  },
  {
    name: 'get_project_context',
    description: 'The project brain: one markdown digest of every diagram, its versions, element tags and notes, the conversation so far, and the links between diagrams. Read this before working in a project you have not seen this session.',
    inputSchema: { type: 'object', properties: { project: PROJECT_REF } }
  },
  {
    name: 'list_diagrams',
    description: 'List the diagrams in a project with element counts and version state.',
    inputSchema: { type: 'object', properties: { project: PROJECT_REF } }
  },
  {
    name: 'create_diagram',
    description: 'Create a diagram in a project and (by default) open it on the canvas so drawing tools target it.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        project: PROJECT_REF,
        description: { type: 'string', description: 'What this diagram shows. One or two sentences.' },
        tags: TAGS,
        open: { type: 'boolean', description: 'Open on the canvas after creating (default: true).' }
      },
      required: ['name']
    }
  },
  {
    name: 'open_diagram',
    description: 'Put a diagram on the live canvas. All element tools (create, update, describe, screenshot, ...) then operate on it. The previous diagram is autosaved first.',
    inputSchema: {
      type: 'object',
      properties: { diagram: { type: 'string', description: 'Diagram id or name.' }, project: PROJECT_REF },
      required: ['diagram']
    }
  },
  {
    name: 'get_active_diagram',
    description: 'Which diagram and project the canvas currently shows, with its version state and browser URL.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'update_diagram',
    description: 'Rename a diagram or change its description or tags.',
    inputSchema: {
      type: 'object',
      properties: { diagram: DIAGRAM_REF, project: PROJECT_REF, name: { type: 'string' }, description: { type: 'string' }, tags: TAGS }
    }
  },
  {
    name: 'delete_diagram',
    description: 'Delete a diagram with all its versions and notes. Irreversible; requires confirm: true.',
    inputSchema: {
      type: 'object',
      properties: { diagram: { type: 'string' }, project: PROJECT_REF, confirm: { type: 'boolean' } },
      required: ['diagram', 'confirm']
    }
  },
  {
    name: 'save_version',
    description: 'Save an immutable, numbered version of a diagram (manual save). Do this after meaningful progress. Versions stay until deleted; the live canvas keeps autosaving separately.',
    inputSchema: {
      type: 'object',
      properties: {
        diagram: DIAGRAM_REF,
        label: { type: 'string', description: 'Short label, e.g. "added expansion tank".' },
        note: { type: 'string', description: 'What changed and why.' },
        author: { type: 'string', description: 'Who saved it, e.g. "claude" (default: "agent").' },
        confirm: { type: 'boolean', description: 'Mark as confirmed immediately. Normally a human confirms in the UI.' }
      }
    }
  },
  {
    name: 'list_versions',
    description: 'List saved versions of a diagram, newest first, with confirmation state.',
    inputSchema: { type: 'object', properties: { diagram: DIAGRAM_REF } }
  },
  {
    name: 'confirm_version',
    description: 'Mark a version as confirmed (or unconfirmed with confirmed: false). Confirmed versions are the ones a human has signed off.',
    inputSchema: {
      type: 'object',
      properties: {
        version: { type: 'string', description: 'Version id, number or "v3".' },
        diagram: DIAGRAM_REF,
        confirmed: { type: 'boolean', description: 'Default true.' }
      },
      required: ['version']
    }
  },
  {
    name: 'restore_version',
    description: 'Replace a diagram with the contents of a saved version. If it is on the canvas the tabs update live. Pass saveCurrentAs to snapshot the current state first.',
    inputSchema: {
      type: 'object',
      properties: {
        version: { type: 'string', description: 'Version id, number or "v3".' },
        diagram: DIAGRAM_REF,
        saveCurrentAs: { type: 'string', description: 'Label for an automatic version of the current state before restoring.' }
      },
      required: ['version']
    }
  },
  {
    name: 'delete_version',
    description: 'Delete a saved version permanently.',
    inputSchema: {
      type: 'object',
      properties: { version: { type: 'string' }, diagram: DIAGRAM_REF },
      required: ['version']
    }
  },
  {
    name: 'add_note',
    description: 'Leave a note in the project conversation. Anchor it to elements with elementIds so humans and later agents know which shapes it is about. Use it for reasoning, open questions, decisions and answers to human notes.',
    inputSchema: {
      type: 'object',
      properties: {
        body: { type: 'string', description: 'Markdown.' },
        diagram: { type: 'string', description: 'Diagram id or name; omit for a project-level note; defaults to the active diagram.' },
        project: PROJECT_REF,
        elementIds: { type: 'array', items: { type: 'string' }, description: 'Elements this note is about.' },
        tags: TAGS,
        author: { type: 'string', description: 'Your name, e.g. "claude" (default: "agent").' },
        projectLevel: { type: 'boolean', description: 'true to attach to the project rather than a diagram.' }
      },
      required: ['body']
    }
  },
  {
    name: 'list_notes',
    description: 'Read the conversation: notes for a project, optionally filtered to one diagram or one element. Human notes are questions and feedback for you; answer them with add_note.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT_REF,
        diagram: { type: 'string', description: 'Diagram id or name. Omit for all notes in the project.' },
        elementId: { type: 'string' },
        includeResolved: { type: 'boolean', description: 'Include resolved notes (default: false).' }
      }
    }
  },
  {
    name: 'resolve_note',
    description: 'Mark a note as resolved (or reopen it with resolved: false).',
    inputSchema: {
      type: 'object',
      properties: { noteId: { type: 'string' }, resolved: { type: 'boolean', description: 'Default true.' } },
      required: ['noteId']
    }
  },
  {
    name: 'tag_elements',
    description: 'Attach semantic tags and an optional note to elements (stored in Excalidraw customData, so they survive export). Tags make shapes searchable across diagrams and show up in get_project_context.',
    inputSchema: {
      type: 'object',
      properties: {
        elementIds: { type: 'array', items: { type: 'string' } },
        tags: { type: 'array', items: { type: 'string' }, description: 'Replace all tags with these.' },
        addTags: { type: 'array', items: { type: 'string' } },
        removeTags: { type: 'array', items: { type: 'string' } },
        note: { type: 'string', description: 'Short note on the element itself (empty string clears it).' },
        diagram: DIAGRAM_REF
      },
      required: ['elementIds']
    }
  },
  {
    name: 'find_by_tag',
    description: 'Find elements carrying a tag, across every diagram or within one.',
    inputSchema: {
      type: 'object',
      properties: { tag: { type: 'string' }, diagram: { type: 'string', description: 'Limit to one diagram (id or name).' } },
      required: ['tag']
    }
  },
  {
    name: 'link_diagrams',
    description: 'Connect two places in a project: a whole diagram to another, or a shape to the diagram that explains it (drill-down). When the source is a shape on the canvas its Excalidraw link is set to the target diagram, so clicking it in the browser jumps there.',
    inputSchema: {
      type: 'object',
      properties: {
        fromDiagram: { type: 'string', description: 'Source diagram id or name (default: active diagram).' },
        fromElementId: { type: 'string', description: 'Optional source shape.' },
        toDiagram: { type: 'string', description: 'Target diagram id or name.' },
        toElementId: { type: 'string' },
        relation: { type: 'string', description: 'e.g. "drills-into", "feeds", "depends-on", "see-also" (default: "relates-to").' },
        note: { type: 'string' },
        project: PROJECT_REF
      },
      required: ['toDiagram']
    }
  },
  {
    name: 'list_links',
    description: 'List links in a project, optionally only those touching one diagram.',
    inputSchema: { type: 'object', properties: { project: PROJECT_REF, diagram: { type: 'string' } } }
  },
  {
    name: 'delete_link',
    description: 'Remove a link between diagrams.',
    inputSchema: { type: 'object', properties: { linkId: { type: 'string' } }, required: ['linkId'] }
  }
];
