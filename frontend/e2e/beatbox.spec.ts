import { expect, test } from '@playwright/test'
import { exportMidi } from './helpers.ts'

// Phase 4 completion check. The fake microphone plays a synthetic beatbox take: a boom-bap
// groove (kick, hats, snare on 2 and 4, open hat at the end) twice, at 90 BPM.

test.setTimeout(180_000)

test('beatbox a groove, correct it, and turn it into drums and a beat', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  await page.goto('/')
  await expect(page.getByTestId('backend-status')).toContainText('Backend ok')
  await page.getByRole('tab', { name: 'Beatbox' }).click()

  await page.getByRole('button', { name: 'Record' }).click()
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible()
  await page.waitForTimeout(12_500) // the groove is ~11.5 s
  await page.getByRole('button', { name: 'Stop recording' }).click()

  const strip = page.getByTestId('hit-strip')
  await expect(strip).toBeVisible({ timeout: 60_000 })
  const labels = await strip
    .getByRole('button')
    .evaluateAll((els) =>
      els.map((e) => (e.getAttribute('aria-label') ?? '').split(':')[1]!.trim().split(/[ ,]/)[0]),
    )
  console.log('[e2e] beatbox classes', labels.join(' '))
  const bar = ['kick', 'hihat', 'snare', 'hihat', 'kick', 'kick', 'snare', 'hihat']
  const expected = [...bar, 'kick', 'hihat', 'snare', 'hihat', 'kick', 'hihat', 'snare', 'openhat']
  expect(labels).toEqual([...expected, ...expected])
  await expect(page.getByLabel('Beatbox tempo')).toHaveValue(/^(90|45|180)$/)
  await page.screenshot({ path: test.info().outputPath('beatbox-review.png') })

  // Correct one hit (the first hat becomes a perc), and map open hats to a clap.
  await strip.getByRole('button', { name: /^Hit 2: hihat/ }).click()
  await strip.getByRole('button', { name: /^Hit 2: openhat/ }).click()
  await strip.getByRole('button', { name: /^Hit 2: perc \(corrected\)/ }).waitFor()
  await page.getByLabel('Sound for Open hat').selectOption('clap')
  await expect(page.getByTestId('beatbox-summary')).toContainText('1 perc')
  await expect(page.getByTestId('beatbox-summary')).toContainText('2 clap')

  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(page.getByTestId('audio-status')).toContainText('Audio running')
  await page.getByRole('button', { name: 'Stop preview' }).click()

  // Into a project: one drum track per sound, editable in the channel rack.
  await page.getByRole('button', { name: 'Create a project with this groove' }).click()
  await expect(page.getByTestId('project-title')).toHaveText('Beatbox groove')
  for (const name of ['BB Kick', 'BB Snare', 'BB Clap', 'BB Hi-hat', 'BB Perc']) {
    await expect(page.getByTestId(`track-${name}`)).toBeVisible()
  }
  const kickStep1 = page.getByRole('button', { name: 'BB Kick step 1', exact: true })
  await expect(kickStep1).toHaveAttribute('aria-pressed', 'true')
  const kickStep2 = page.getByRole('button', { name: 'BB Kick step 2', exact: true })
  await kickStep2.click()
  await expect(kickStep2).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.getByLabel('Playhead position')).not.toHaveText('1.1.1', { timeout: 5000 })
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Unsaved changes')).toBeHidden()
  await page.screenshot({ path: test.info().outputPath('beatbox-rack.png') })

  // Expand it into a whole beat.
  await page.getByRole('tab', { name: 'Beatbox' }).click()
  await page.getByLabel('Beat description for the groove').fill('dusty boom bap with jazzy keys')
  await page.getByRole('button', { name: 'Build a beat around it' }).click()
  await expect(page.getByTestId('project-title')).not.toHaveText('Beatbox groove', {
    timeout: 20_000,
  })
  await expect(page.getByTestId('plan-card').last()).toContainText('groove, expanded')
  await expect(page.getByTestId('track-Kick')).toBeVisible()
  await expect(page.getByTestId('track-Keys')).toBeVisible()

  const midi = await exportMidi(page)
  const kick = midi.tracks.find((t) => t.name === 'Kick')!
  expect([...kick.channels]).toEqual([9])
  expect(kick.noteOns).toBeGreaterThan(20)
  await page.screenshot({ path: test.info().outputPath('beatbox-beat.png') })

  expect(consoleErrors).toEqual([])
})
