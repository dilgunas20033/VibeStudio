import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../../App'
import { useBeatboxStore } from '../../store/beatboxStore'
import { useProjectStore } from '../../store/projectStore'
import { useTransportStore } from '../../store/transportStore'
import { useUiStore } from '../../store/uiStore'
import { installFakeBackend } from '../../test/fakeBackend'
import type { BeatboxTranscription } from '../../types/api'

vi.mock('../../audio/recorder', () => ({
  startRecording: async () => ({
    level: () => 0.5,
    stop: async () => new Blob(['webm'], { type: 'audio/webm' }),
    cancel: () => {},
  }),
  toMonoWav: async () => ({
    wav: new Blob(['RIFF'], { type: 'audio/wav' }),
    seconds: 3,
    peaks: [0.2, 0.9, 0.3, 0.8],
  }),
  listInputDevices: async () => [],
}))
const engine = vi.hoisted(() => ({
  unlock: vi.fn(async () => {}),
  previewDrums: vi.fn(() => 2),
  stopPreview: vi.fn(),
  sync: vi.fn(),
  clear: vi.fn(),
  stop: vi.fn(),
  setLoop: vi.fn(),
  info: vi.fn(() => ({ state: 'running', sampleRate: 48_000 })),
}))
vi.mock('../../audio', () => ({
  getEngine: async () => engine,
  peekEngine: () => engine,
  renderLoopWav: vi.fn(),
}))

const hit = (time: number, drum: BeatboxTranscription['hits'][number]['drum'], confidence = 0.9) => ({
  time, drum, confidence, velocity: 100, centroidHz: 1000, lowRatio: 0.2, highRatio: 0.2, decayS: 0.05,
}) // prettier-ignore
const TRANSCRIPTION: BeatboxTranscription = {
  assetId: 'ast_bb',
  method: 'onset-rules-v1',
  duration: 3,
  // 120 BPM: kick, hat, snare (uncertain), hat
  hits: [hit(0.5, 'kick'), hit(0.75, 'hihat'), hit(1.0, 'snare', 0.4), hit(1.25, 'hihat')],
  tempo: { bpm: 120, confidence: 0.7, alternatives: [60] },
  warnings: [],
}

const initial = {
  project: useProjectStore.getState(),
  transport: useTransportStore.getState(),
  beatbox: useBeatboxStore.getState(),
  ui: useUiStore.getState(),
}
let backend: ReturnType<typeof installFakeBackend>

beforeEach(() => {
  useProjectStore.setState(initial.project, true)
  useTransportStore.setState(initial.transport, true)
  useBeatboxStore.setState(initial.beatbox, true)
  useUiStore.setState(initial.ui, true)
  backend = installFakeBackend()
  const fake = backend.fetchMock.getMockImplementation()!
  backend.fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.includes('/api/assets'))
      return new Response(
        JSON.stringify({
          id: 'ast_bb', uri: 'asset://audio/ast_bb', name: 'bb.wav', kind: 'beatbox', sha256: 'b'.repeat(64),
          sampleRate: 22050, channels: 1, durationSeconds: 3, sizeBytes: 10, createdAt: '2026-01-01',
        }),
        { status: 201 },
      ) // prettier-ignore
    if (url.endsWith('/api/transcribe/beatbox'))
      return new Response(JSON.stringify(TRANSCRIPTION), { status: 200 })
    return fake(input, init)
  })
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:take', revokeObjectURL: () => {} }),
  )
})
afterEach(() => vi.unstubAllGlobals())

async function recordTake(user: ReturnType<typeof userEvent.setup>) {
  render(<App />)
  await user.click(screen.getByRole('tab', { name: 'Beatbox' }))
  await user.click(screen.getByRole('button', { name: 'Record' }))
  await user.click(await screen.findByRole('button', { name: 'Stop recording' }))
  await screen.findByTestId('hit-strip')
}

it('detects hits, lets the user correct them, and previews the groove', async () => {
  const user = userEvent.setup()
  await recordTake(user)
  const upload = backend.fetchMock.mock.calls.find(([u]) => String(u).includes('/api/assets'))!
  expect(String(upload[0])).toContain('kind=beatbox')
  const summary = screen.getByTestId('beatbox-summary')
  expect(summary).toHaveTextContent('4 hits · 1 kick, 2 hihat, 1 snare')

  // Click the uncertain snare: snare -> clap. Then map hi-hats to perc.
  const strip = screen.getByTestId('hit-strip')
  await user.click(within(strip).getByRole('button', { name: /^Hit 3: snare, 40% confident/ }))
  expect(
    within(strip).getByRole('button', { name: /^Hit 3: clap \(corrected\)/ }),
  ).toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('Sound for Hi-hat'), 'perc')
  expect(summary).toHaveTextContent('1 kick, 2 perc, 1 clap')
  expect(
    within(screen.getByTestId('drum-grid')).getByLabelText('Clap on step 5'),
  ).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Preview' }))
  await waitFor(() => expect(engine.previewDrums).toHaveBeenCalled())
  const [hits, bpm] = engine.previewDrums.mock.lastCall as unknown as [{ drum: string }[], number]
  expect(bpm).toBe(120)
  expect(hits.slice(0, 4).map((h) => h.drum)).toEqual(['kick', 'perc', 'clap', 'perc'])
  expect(hits).toHaveLength(8) // two passes of the pattern
})

it('creates a project with one drum track per sound', async () => {
  const user = userEvent.setup()
  await recordTake(user)
  await user.click(screen.getByRole('button', { name: 'Create a project with this groove' }))
  await waitFor(() =>
    expect(screen.getByTestId('project-title')).toHaveTextContent('Beatbox groove'),
  )
  const doc = useProjectStore.getState().current!.document
  expect(doc.tracks.map((t) => t.name)).toEqual(['BB Kick', 'BB Snare', 'BB Hi-hat'])
  expect(doc.bpm).toBe(120)
  expect(doc.assets.map((a) => a.id)).toEqual(['ast_bb'])
  // It lands in the channel rack, ready to edit.
  expect(screen.getByRole('tab', { name: 'Channel rack' })).toHaveAttribute('aria-selected', 'true')
  const steps = screen.getByRole('group', { name: 'BB Hi-hat steps' })
  expect(within(steps).getByRole('button', { name: 'BB Hi-hat step 3' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

it('expands the groove into a beat', async () => {
  const user = userEvent.setup()
  await recordTake(user)
  await user.type(screen.getByLabelText('Beat description for the groove'), 'dark trap')
  await user.click(screen.getByRole('button', { name: 'Build a beat around it' }))
  await waitFor(() =>
    expect(screen.getByTestId('project-title')).toHaveTextContent('Dark Trap Beat'),
  )
  const call = backend.fetchMock.mock.calls.find(([u]) => String(u).endsWith('/api/generate'))!
  const body = JSON.parse(String(call[1]!.body))
  expect(body).toMatchObject({ prompt: 'dark trap', bpm: 120 })
  expect(body.drums).toMatchObject({ mode: 'expand', sourceAssetId: 'ast_bb' })
  expect(body.drums.hits.map((h: { drum: string }) => h.drum)).toEqual([
    'kick',
    'hihat',
    'snare',
    'hihat',
  ])
  expect(body.drums.hits[0]).not.toHaveProperty('sourceIndex')
})
