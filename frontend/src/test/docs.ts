import type { ProjectDocument } from '../types/project.generated'

/** A valid empty v1 document for tests. */
export function emptyDoc(overrides: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    schemaVersion: 1,
    id: 'prj_test',
    name: 'Test',
    bpm: 120,
    key: { root: 'C', mode: 'minor' },
    timeSignature: { numerator: 4, denominator: 4 },
    tracks: [],
    patterns: [],
    clips: [],
    sections: [],
    assets: [],
    aiHistory: [],
    ...overrides,
  }
}
