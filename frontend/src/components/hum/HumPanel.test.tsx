import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../../App'
import { useHumStore } from '../../store/humStore'
import { useProjectStore } from '../../store/projectStore'
import { useTransportStore } from '../../store/transportStore'
import { useUiStore } from '../../store/uiStore'
import { installFakeBackend } from '../../test/fakeBackend'
import type { MelodyTranscription } from '../../types/api'

// Microphones and Web Audio don't exist in jsdom; the real recorder runs in the e2e test.
const mic = vi.hoisted(() => ({
  startRecording: vi.fn(async () => ({
    level: () => 0.4,
    stop: async () => new Blob(['webm'], { type: 'audio/webm' }),
    cancel: vi.fn(),
  })),
  toMonoWav: vi.fn(async () => ({
    wav: new Blob(['RIFF'], { type: 'audio/wav' }),
    seconds: 4,
    peaks: [0.1, 0.5, 0.8, 0.2],
  })),
}))
vi.mock('../../audio/recorder', () => ({
  startRecording: mic.startRecording,
  toMonoWav: mic.toMonoWav,
  listInputDevices: async () => [],
}))
const engine = vi.hoisted(() => ({
  unlock: vi.fn(async () => {}),
  previewNotes: vi.fn(() => 2),
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

const TRANSCRIPTION: MelodyTranscription = {
  assetId: 'ast_1',
  method: 'pyin-v1',
  duration: 4,
  tuningCents: 12,
  notes: [
    { start: 0.5, end: 0.95, pitch: 60, pitchCents: 2, confidence: 0.95, velocity: 100 },
    { start: 1.0, end: 1.45, pitch: 64, pitchCents: -5, confidence: 0.35, velocity: 90 },
    { start: 1.5, end: 2.45, pitch: 67, pitchCents: 4, confidence: 0.9, velocity: 95 },
  ],
  tempo: { bpm: 120, confidence: 0.8, alternatives: [60] },
  key: { root: 'C', mode: 'major', confidence: 0.7 },
  curveTimes: [0.5, 1.0, 1.5],
  curveMidi: [60, 64, 67],
  warnings: [],
}

const initial = {
  project: useProjectStore.getState(),
  transport: useTransportStore.getState(),
  hum: useHumStore.getState(),
  ui: useUiStore.getState(),
}
let backend: ReturnType<typeof installFakeBackend>

beforeEach(() => {
  useProjectStore.setState(initial.project, true)
  useTransportStore.setState(initial.transport, true)
  useHumStore.setState(initial.hum, true)
  useUiStore.setState(initial.ui, true)
  backend = installFakeBackend()
  const fake = backend.fetchMock.getMockImplementation()!
  backend.fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.includes('/api/assets'))
      return new Response(
        JSON.stringify({
          id: 'ast_1', uri: 'asset://audio/ast_1', name: 'hum.wav', kind: 'hum', sha256: 'a'.repeat(64),
          sampleRate: 22050, channels: 1, durationSeconds: 4, sizeBytes: 100, createdAt: '2026-01-01',
        }),
        { status: 201 },
      ) // prettier-ignore
    if (url.endsWith('/api/transcribe/melody'))
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
  await user.click(screen.getByRole('tab', { name: 'Hum' }))
  await user.click(screen.getByRole('button', { name: 'Record' }))
  await screen.findByRole('button', { name: 'Stop recording' })
  await user.click(screen.getByRole('button', { name: 'Stop recording' }))
  await screen.findByTestId('melody-review')
}

it('records, uploads, transcribes and shows the melody for review', async () => {
  const user = userEvent.setup()
  await recordTake(user)
  const upload = backend.fetchMock.mock.calls.find(([u]) => String(u).includes('/api/assets'))!
  expect(String(upload[0])).toContain('kind=hum')
  expect(screen.getByTestId('take-waveform')).toBeInTheDocument()
  expect(screen.getByTestId('hum-summary')).toHaveTextContent('3 notes · key C major (70%)')
  expect(screen.getByTestId('hum-summary')).toHaveTextContent('1 uncertain')
  expect(screen.getByLabelText('Hum tempo')).toHaveValue(120)

  // Leave out a note, then bring it back.
  await user.click(screen.getByRole('button', { name: /^E4, 35% confident/ }))
  expect(screen.getByTestId('hum-summary')).toHaveTextContent('2 notes')
  await user.click(screen.getByRole('button', { name: 'E4, left out' }))
  expect(screen.getByTestId('hum-summary')).toHaveTextContent('3 notes')

  // Octave up, then preview plays the quantized notes on the chosen instrument.
  await user.click(screen.getByRole('button', { name: 'Octave up' }))
  await user.selectOptions(screen.getByLabelText('Melody instrument'), 'pluck')
  await user.click(screen.getByRole('button', { name: 'Preview' }))
  await waitFor(() => expect(engine.previewNotes).toHaveBeenCalled())
  const [notes, bpm, preset] = engine.previewNotes.mock.lastCall as unknown as [
    { startBeat: number; pitch: number }[],
    number,
    string,
  ]
  expect(notes.map((n) => [n.startBeat, n.pitch])).toEqual([
    [0, 72],
    [1, 76],
    [2, 79],
  ])
  expect([bpm, preset]).toEqual([120, 'pluck'])
})

it('creates a project from the melody, then corrects notes in the piano roll', async () => {
  const user = userEvent.setup()
  await recordTake(user)
  await user.click(screen.getByRole('button', { name: 'Create a project with this melody' }))
  await waitFor(() =>
    expect(screen.getByTestId('project-title')).toHaveTextContent('Hummed melody'),
  )
  const doc = useProjectStore.getState().current!.document
  expect(doc.bpm).toBe(120)
  const create = backend.fetchMock.mock.calls.find(
    ([u, init]) => String(u).endsWith('/api/projects') && init?.method === 'POST',
  )!
  expect(JSON.parse(String(create[1]!.body)).key).toEqual({ root: 'C', mode: 'major' })
  expect(doc.assets.map((a) => a.id)).toEqual(['ast_1'])
  const pattern = doc.patterns[0]!
  expect(pattern.notes.map((n) => n.pitch)).toEqual([60, 64, 67])
  expect(screen.getByRole('tab', { name: 'Piano roll' })).toHaveAttribute('aria-selected', 'true')

  // The uncertain note is marked; selecting and moving it up confirms it.
  const grid = screen.getByTestId('piano-grid')
  const e4 = within(grid).getByRole('button', { name: /Note E4 at beat 2, 35% confident/ })
  fireEvent.pointerDown(e4)
  expect(e4).toHaveAttribute('aria-pressed', 'true')
  fireEvent.keyDown(grid, { key: 'ArrowUp' })
  const fixed = useProjectStore.getState().current!.document.patterns[0]!.notes[1]!
  expect(fixed).toMatchObject({ pitch: 65, confidence: null })
  expect(within(grid).getByRole('button', { name: 'Note F4 at beat 2' })).toBeInTheDocument()

  // Delete removes the selection.
  fireEvent.keyDown(grid, { key: 'Delete' })
  expect(useProjectStore.getState().current!.document.patterns[0]!.notes).toHaveLength(2)
})

it('builds a beat around the melody', async () => {
  const user = userEvent.setup()
  await recordTake(user)
  await user.type(screen.getByLabelText('Beat description for the melody'), 'dark trap')
  await user.click(screen.getByRole('radio', { name: 'Also vary it in the verse' }))
  await user.click(screen.getByRole('button', { name: 'Build a beat around it' }))
  await waitFor(() =>
    expect(screen.getByTestId('project-title')).toHaveTextContent('Dark Trap Beat'),
  )
  const call = backend.fetchMock.mock.calls.find(([u]) => String(u).endsWith('/api/generate'))!
  const body = JSON.parse(String(call[1]!.body))
  expect(body).toMatchObject({ prompt: 'dark trap', bpm: 120 })
  expect(body.melody).toMatchObject({ instrument: 'lead', mode: 'vary', sourceAssetId: 'ast_1' })
  expect(body.melody.notes).toHaveLength(3)
  expect(body.melody.notes[0]).not.toHaveProperty('sourceIndex')
  expect(screen.getAllByTestId('plan-card').length).toBeGreaterThan(0)
})

it('reports microphone problems', async () => {
  mic.startRecording.mockRejectedValueOnce(new Error('Microphone access was blocked.'))
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('tab', { name: 'Hum' }))
  await user.click(screen.getByRole('button', { name: 'Record' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Microphone access was blocked.')
})
