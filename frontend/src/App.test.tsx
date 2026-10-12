import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { useProjectStore } from './store/projectStore'
import { useTransportStore } from './store/transportStore'
import { installFakeBackend } from './test/fakeBackend'

// The real engine needs Web Audio, which jsdom lacks. Audio output is covered by the
// browser end-to-end test (e2e/). Here we check the UI drives the engine correctly.
const engine = vi.hoisted(() => ({
  unlock: vi.fn(async () => {}),
  sync: vi.fn(),
  clear: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
  seek: vi.fn(),
  position: vi.fn(() => 0),
  status: vi.fn(() => 'playing' as const),
  setLoop: vi.fn(),
  setMetronome: vi.fn(),
  preview: vi.fn(),
  info: vi.fn(() => ({ state: 'running', sampleRate: 48_000 })),
  previewNotes: vi.fn(() => 1),
  previewDrums: vi.fn(() => 1),
  stopPreview: vi.fn(),
  dispose: vi.fn(),
}))
vi.mock('./audio', () => ({
  getEngine: async () => engine,
  peekEngine: () => engine,
  renderLoopWav: vi.fn(),
}))

const initialProject = useProjectStore.getState()
const initialTransport = useTransportStore.getState()
let backend: ReturnType<typeof installFakeBackend>

beforeEach(() => {
  useProjectStore.setState(initialProject, true)
  useTransportStore.setState(initialTransport, true)
  backend = installFakeBackend()
  vi.clearAllMocks()
})
afterEach(() => vi.unstubAllGlobals())

async function createProject(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.type(screen.getByLabelText('New project name'), name)
  await user.click(screen.getByRole('button', { name: 'Create' }))
  await waitFor(() => expect(screen.getByTestId('project-title')).toHaveTextContent(name))
}

it('creates a project, programs a beat, plays it, and saves it', async () => {
  const user = userEvent.setup()
  render(<App />)
  await waitFor(() => expect(screen.getByTestId('backend-status')).toHaveTextContent('Backend ok'))
  await createProject(user, 'First Beat')

  const save = screen.getByRole('button', { name: 'Save' })
  expect(save).toBeDisabled()

  // Program the kick on steps 1 and 9.
  const rack = screen.getByRole('group', { name: 'Kick steps' })
  await user.click(within(rack).getByRole('button', { name: 'Kick step 1' }))
  await user.click(within(rack).getByRole('button', { name: 'Kick step 9' }))
  expect(within(rack).getByRole('button', { name: 'Kick step 1' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  await waitFor(() => expect(engine.preview).toHaveBeenCalledWith('trk_kick', 36))

  // Play hands the current document to the engine.
  await user.click(screen.getByRole('button', { name: 'Play' }))
  await waitFor(() => expect(engine.play).toHaveBeenCalled())
  const synced = engine.sync.mock.lastCall?.[0]
  expect(synced.patterns[0].notes.map((n: { startBeat: number }) => n.startBeat)).toEqual([0, 2])

  // Muting while playing pushes the change to the engine immediately.
  await user.click(screen.getByRole('button', { name: 'Mute Kick' }))
  expect(engine.sync.mock.lastCall?.[0].tracks[0].mixer.mute).toBe(true)

  await user.click(screen.getByRole('button', { name: 'Stop' }))
  expect(engine.stop).toHaveBeenCalled()

  await user.click(save)
  await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument())
  expect(screen.getByText('revision 2')).toBeInTheDocument()
  const stored = [...backend.projects.values()][0]!.doc
  expect(stored.patterns[0]!.notes).toHaveLength(2)
  expect(stored.tracks[0]!.mixer.mute).toBe(true)
})

it('tempo field can be cleared and retyped', async () => {
  const user = userEvent.setup()
  render(<App />)
  await createProject(user, 'Tempo')
  const bpm = screen.getByLabelText('Tempo')
  await user.clear(bpm)
  await user.type(bpm, '145')
  await user.tab()
  expect(useProjectStore.getState().current?.document.bpm).toBe(145)
})

it('adds and deletes tracks', async () => {
  const user = userEvent.setup()
  render(<App />)
  await createProject(user, 'Tracks')
  await user.selectOptions(screen.getByLabelText('Add track'), 'instrument:lead')
  expect(screen.getByTestId('track-Lead')).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Piano roll' })).toHaveAttribute('aria-selected', 'true')

  await user.click(screen.getByRole('button', { name: 'Delete Lead' }))
  await user.click(screen.getByRole('button', { name: 'Delete?' }))
  expect(screen.queryByTestId('track-Lead')).not.toBeInTheDocument()
})
