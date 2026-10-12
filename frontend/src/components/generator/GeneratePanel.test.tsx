import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../../App'
import { useGeneratorStore } from '../../store/generatorStore'
import { useProjectStore } from '../../store/projectStore'
import { useTransportStore } from '../../store/transportStore'
import { useUiStore } from '../../store/uiStore'
import { installFakeBackend } from '../../test/fakeBackend'

vi.mock('../../audio', () => ({
  getEngine: async () => ({}),
  peekEngine: () => null,
  renderLoopWav: vi.fn(),
}))

const initial = {
  project: useProjectStore.getState(),
  transport: useTransportStore.getState(),
  generator: useGeneratorStore.getState(),
  ui: useUiStore.getState(),
}
let backend: ReturnType<typeof installFakeBackend>

beforeEach(() => {
  useProjectStore.setState(initial.project, true)
  useTransportStore.setState(initial.transport, true)
  useGeneratorStore.setState(initial.generator, true)
  useUiStore.setState(initial.ui, true)
  backend = installFakeBackend()
})
afterEach(() => vi.unstubAllGlobals())

it('previews, generates and opens an editable multi-section beat', async () => {
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('tab', { name: 'AI Beat' }))
  await user.type(screen.getByLabelText('Beat description'), 'dark trap at 145 bpm')

  // Settings default to Auto; a user override is sent to the server.
  await user.click(screen.getByText('Settings (optional)'))
  await user.selectOptions(screen.getByLabelText('Scale'), 'minor')
  await user.click(screen.getByRole('button', { name: 'Preview' }))
  const card = await screen.findByTestId('plan-card')
  expect(card).toHaveTextContent('Dark Trap Beat')
  expect(card).toHaveTextContent('Preview · seed 42')
  expect(card).toHaveTextContent('from prompt')
  expect(within(card).getByLabelText('Generation notes')).toHaveTextContent('808 slides')
  expect(card).toHaveTextContent('keyword rules')
  const previewCall = backend.fetchMock.mock.calls.find(([u]) => String(u).endsWith('/plan'))!
  expect(JSON.parse(String(previewCall[1]!.body))).toEqual({
    prompt: 'dark trap at 145 bpm',
    keyMode: 'minor',
  })
  expect(backend.projects.size).toBe(0) // preview creates nothing

  await user.click(screen.getByRole('button', { name: 'Generate beat' }))
  await waitFor(() =>
    expect(screen.getByTestId('project-title')).toHaveTextContent('Dark Trap Beat'),
  )
  expect(screen.getByTestId('plan-card')).toHaveTextContent('Generated · seed 42')

  // Sections appear in the ruler; arranged songs show their length, not a loop selector.
  const sections = screen.getByLabelText('Song sections')
  expect(within(sections).getByRole('button', { name: 'Intro' })).toBeInTheDocument()
  expect(screen.queryByLabelText('Loop length in bars')).not.toBeInTheDocument()
  expect(screen.getByText(/Song/)).toHaveTextContent('Song 4 bars')

  // The intro has no kick; the hook does. Editing follows the focused section.
  expect(screen.getByText('Silent in this section.')).toBeInTheDocument()
  await user.click(within(sections).getByRole('button', { name: 'Hook' }))
  const steps = screen.getByRole('group', { name: 'Kick steps' })
  expect(within(steps).getByRole('button', { name: 'Kick step 1' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await user.click(within(steps).getByRole('button', { name: 'Kick step 5' }))
  const doc = useProjectStore.getState().current!.document
  expect(doc.patterns.find((p) => p.id === 'pat_hk')!.notes).toHaveLength(2)
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument()

  // Back in the intro, give the kick its own pattern.
  await user.click(within(sections).getByRole('button', { name: 'Intro' }))
  await user.click(screen.getByRole('button', { name: '+ Add pattern here' }))
  expect(screen.getByRole('group', { name: 'Kick steps' })).toBeInTheDocument()
  const clips = useProjectStore
    .getState()
    .current!.document.clips.filter((c) => c.trackId === 'trk_gk')
  expect(clips.map((c) => c.startBeat).sort()).toEqual([0, 8])
})

it('shows generation errors', async () => {
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('tab', { name: 'AI Beat' }))
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
  await user.click(screen.getByRole('button', { name: 'Generate beat' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the VibeStudio backend')
})
