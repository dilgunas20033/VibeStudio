import { expect, test } from '@playwright/test'
import { exportMidi } from './helpers.ts'

// Phase 3 completion check. The browser's fake microphone plays a synthetic hum of
// "Twinkle Twinkle" (C C G G A A G, F F E E D D C) at 100 BPM, 30 cents sharp.
// The real pipeline runs: MediaRecorder -> WAV -> upload -> pYIN -> review -> project.

const TWINKLE = ['C', 'C', 'G', 'G', 'A', 'A', 'G', 'F', 'F', 'E', 'E', 'D', 'D', 'C']

test.setTimeout(180_000)

test('hum a melody, correct it, and build a beat around it', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  await page.goto('/')
  await expect(page.getByTestId('backend-status')).toContainText('Backend ok')
  await page.getByRole('tab', { name: 'Hum' }).click()

  // Record the take (the fixture is ~10.5 s of humming).
  await page.getByRole('button', { name: 'Record' }).click()
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible()
  await expect(page.getByRole('meter', { name: 'Input level' })).not.toHaveAttribute(
    'aria-valuenow',
    '0',
    { timeout: 5000 },
  )
  await page.waitForTimeout(11_500)
  await page.getByRole('button', { name: 'Stop recording' }).click()

  // Waveform, then the detected melody.
  await expect(page.getByTestId('take-waveform')).toBeVisible({ timeout: 30_000 })
  const review = page.getByTestId('melody-review')
  await expect(review).toBeVisible({ timeout: 60_000 })
  const summary = page.getByTestId('hum-summary')
  await expect(summary).toContainText('key C major')
  const noteLabels = await review
    .getByRole('button')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
  const names = noteLabels.map((l) => l.replace(/[0-9#].*$/, ''))
  console.log('[e2e] hummed notes', noteLabels)
  expect(names).toEqual(TWINKLE)
  await expect(page.getByLabel('Hum tempo')).toHaveValue(/^(100|50|200|99|101)$/)
  await page.screenshot({ path: test.info().outputPath('hum-review.png') })

  // Preview plays it (audio engine starts).
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(page.getByTestId('audio-status')).toContainText('Audio running')
  await page.getByRole('button', { name: 'Stop preview' }).click()

  // Create a project from it and correct a note in the piano roll.
  await page.getByRole('button', { name: 'Create a project with this melody' }).click()
  await expect(page.getByTestId('project-title')).toHaveText('Hummed melody')
  const grid = page.getByTestId('piano-grid')
  const notes = grid.getByRole('button', { name: /^Note / })
  await expect(notes).toHaveCount(14)
  await notes.first().click()
  await page.keyboard.press('ArrowUp')
  await expect(grid.getByRole('button', { name: /^Note C#4 at beat 1$/ })).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Delete')
  await expect(notes).toHaveCount(13)
  await page.screenshot({ path: test.info().outputPath('hum-piano-roll.png') })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Unsaved changes')).toBeHidden()

  // Build a beat around the melody: key and chords follow it, notes kept exactly.
  await page.getByRole('tab', { name: 'Hum' }).click()
  await page
    .getByLabel('Beat description for the melody')
    .fill('Turn this into a futuristic melodic trap beat with atmospheric synths and heavy bass.')
  await page.getByRole('button', { name: 'Build a beat around it' }).click()
  await expect(page.getByTestId('project-title')).not.toHaveText('Hummed melody', {
    timeout: 20_000,
  })
  await expect(page.getByTestId('track-Melody')).toBeVisible()
  await expect(page.getByTestId('track-808')).toBeVisible()
  const card = page.getByTestId('plan-card').last()
  await expect(card).toContainText('C major')
  await expect(card).toContainText('kept exactly')

  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.getByLabel('Playhead position')).not.toHaveText('1.1.1', { timeout: 5000 })
  await page.getByRole('button', { name: 'Stop', exact: true }).click()

  const midi = await exportMidi(page)
  const melody = midi.tracks.find((t) => t.name === 'Melody')!
  expect(melody.noteOns % 14).toBe(0) // the 14 hummed notes, repeated in each hook/outro
  expect(melody.noteOns).toBeGreaterThanOrEqual(28)
  await page.screenshot({ path: test.info().outputPath('hum-beat.png') })

  expect(consoleErrors).toEqual([])
})
