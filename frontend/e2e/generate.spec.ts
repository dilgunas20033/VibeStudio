import { expect, test } from '@playwright/test'
import { exportMidi, exportWav } from './helpers.ts'

// Phase 2 completion check, in a real browser against the real backend:
// a description creates a multi-track project that plays, can be edited, and exports
// to WAV and MIDI.

const PROMPT =
  'Make me a dark futuristic melodic trap beat at 145 BPM with spacey synthesizers, a dreamy ' +
  'lead melody, heavy distorted 808s, punchy kicks, rolling hi-hats, and atmospheric ' +
  'background textures. Make it emotional but energetic.'

test.setTimeout(300_000)

test('the example prompt becomes an editable, playable, exportable song', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))

  await page.goto('/')
  await expect(page.getByTestId('backend-status')).toContainText('Backend ok')
  await page.getByRole('tab', { name: 'AI Beat' }).click()
  await page.getByLabel('Beat description').fill(PROMPT)
  await page.getByText('Settings (optional)').click()
  await page.getByLabel('Seed').fill('2024')

  // Preview shows the reading before anything is created.
  await page.getByRole('button', { name: 'Preview' }).click()
  const card = page.getByTestId('plan-card')
  await expect(card).toContainText('Preview')
  await expect(card).toContainText('Trap')
  await expect(card).toContainText('145 BPM')
  await expect(card).toContainText('keyword rules')

  await page.getByRole('button', { name: 'Generate beat' }).click()
  await expect(card).toContainText('Generated · seed 2024', { timeout: 15_000 })
  await expect(page.getByTestId('project-title')).not.toBeEmpty()

  // Multiple working tracks, arranged in sections.
  for (const name of ['Kick', 'Snare', 'Hi-hat', '808', 'Pad', 'Lead']) {
    await expect(page.getByTestId(`track-${name}`)).toBeVisible()
  }
  const sections = page.getByLabel('Song sections')
  for (const s of ['Intro', 'Hook', 'Verse', 'Outro']) {
    await expect(sections.getByRole('button', { name: s, exact: true })).toBeVisible()
  }
  await page.screenshot({ path: test.info().outputPath('generated.png') })

  // It plays.
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.getByTestId('audio-status')).toContainText('Audio running')
  await expect(page.getByLabel('Playhead position')).not.toHaveText('1.1.1', { timeout: 5000 })
  await page.getByRole('button', { name: 'Stop', exact: true }).click()

  // It is editable: change a hook kick step, open the lead in the piano roll.
  await sections.getByRole('button', { name: 'Hook', exact: true }).click()
  const step = page.getByRole('button', { name: 'Kick step 2', exact: true })
  const before = await step.getAttribute('aria-pressed')
  await step.click()
  await expect(step).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true')
  await expect(page.getByText('Unsaved changes')).toBeVisible()
  await page
    .getByRole('button', { name: /^Edit Hook Lead/ })
    .first()
    .click()
  await expect(page.getByRole('tab', { name: 'Piano roll' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByRole('button', { name: /^Note / }).first()).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('generated-piano.png') })

  // It exports: MIDI with one track per instrument plus a conductor track with sections.
  const midi = await exportMidi(page)
  const trackCount = await page.locator('[data-testid^="track-"]').count()
  expect(midi.format).toBe(1)
  expect(midi.tracks).toHaveLength(trackCount + 1)
  expect(midi.bpm).toBeCloseTo(145, 3)
  expect(midi.markers).toEqual(expect.arrayContaining(['Intro', 'Hook', 'Verse', 'Outro']))
  const kick = midi.tracks.find((t) => t.name === 'Kick')!
  expect(kick.noteOns).toBeGreaterThan(20)
  expect([...kick.channels]).toEqual([9])
  const lead = midi.tracks.find((t) => t.name === 'Lead')!
  expect(lead.noteOns).toBeGreaterThan(10)

  // ...and the whole song renders to real, unclipped audio of the right length.
  const bars = Number(
    await page.getByTitle('Song length (end of the last clip)').locator('span').textContent(),
  )
  const wav = await exportWav(page)
  expect(wav.seconds).toBeCloseTo((bars * 4 * 60) / 145 + 1.5, 0)
  expect(wav.peak).toBeGreaterThan(0.2)
  expect(wav.peak).toBeLessThan(0.99)
  expect(wav.rms).toBeGreaterThan(0.02)
  console.log('[e2e] generated song', {
    bars,
    tracks: trackCount,
    midi: midi.tracks.map((t) => [t.name, t.noteOns]),
    wav,
  })

  // Saving keeps the edit; the project is listed.
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Unsaved changes')).toBeHidden()
  await page.getByRole('tab', { name: 'Projects' }).click()
  await expect(page.getByRole('list', { name: 'Project list' })).toContainText('145 BPM')

  expect(consoleErrors).toEqual([])
})
