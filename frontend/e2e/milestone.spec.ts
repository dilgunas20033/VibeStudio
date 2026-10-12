import { expect, test } from '@playwright/test'
import { exportWav } from './helpers.ts'

// The first milestone, in a real browser with real Web Audio:
// open VibeStudio, create a pattern, press Play, hear audio, change it, save, reopen.

const name = `E2E ${Date.now()}`

test('demo beat plays, renders real audio, and responds to edits', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))

  await page.goto('/')
  await expect(page.getByTestId('backend-status')).toContainText('Backend ok')

  await page.getByLabel('New project name').fill(name)
  await page.getByLabel('Project template').selectOption('demo')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByTestId('project-title')).toHaveText(name)

  // Play: the AudioContext starts and the transport advances.
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await expect(page.getByLabel('Playhead position')).not.toHaveText('1.1.1', { timeout: 5000 })
  await expect(page.getByTestId('audio-status')).toContainText('Audio running')
  await page.screenshot({ path: test.info().outputPath('daw-playing.png') })
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.getByLabel('Playhead position')).toHaveText('1.1.1')

  // The rendered loop is real, non-silent, unclipped stereo audio of the right length.
  const full = await exportWav(page)
  expect(full.channels).toBe(2)
  expect(full.sampleRate).toBe(44_100)
  // 2 bars of 4/4 at 140 BPM = 8 beats = 3.43 s, plus a 1.5 s tail.
  expect(full.seconds).toBeCloseTo((8 * 60) / 140 + 1.5, 1)
  expect(full.peak).toBeGreaterThan(0.1)
  expect(full.peak).toBeLessThan(0.99)
  expect(full.rms).toBeGreaterThan(0.01)

  // Muting every track silences the output.
  const muteButtons = page.getByRole('button', { name: /^Mute / })
  const count = await muteButtons.count()
  expect(count).toBeGreaterThanOrEqual(5)
  for (let i = 0; i < count; i++) await muteButtons.nth(i).click()
  const muted = await exportWav(page)
  expect(muted.peak).toBeLessThan(0.001)

  // Unmute only the kick and change the tempo: still audible, and the timing changes.
  await page.getByRole('button', { name: 'Mute Kick', exact: true }).click()
  const tempo = page.getByLabel('Tempo')
  await tempo.fill('70')
  await tempo.blur()
  const kickOnly = await exportWav(page)
  expect(kickOnly.peak).toBeGreaterThan(0.05)
  expect(kickOnly.seconds).toBeCloseTo((8 * 60) / 70 + 1.5, 1)
  expect(kickOnly.rms).toBeLessThan(full.rms)
  console.log('[e2e] levels', { full, muted, kickOnly })

  // Edit the pattern: add a kick hit on step 5, then save.
  const step5 = page.getByRole('button', { name: 'Kick step 5', exact: true })
  await expect(step5).toHaveAttribute('aria-pressed', 'false')
  await step5.click()
  await expect(step5).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Unsaved changes')).toBeVisible()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Unsaved changes')).toBeHidden()

  // Reload the browser and reopen: everything persisted.
  await page.reload()
  await page.getByRole('button', { name: new RegExp(name) }).click()
  await expect(page.getByTestId('project-title')).toHaveText(name)
  await expect(page.getByLabel('Tempo')).toHaveValue('70')
  await expect(page.getByRole('button', { name: 'Kick step 5', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: 'Mute Kick', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(page.getByRole('button', { name: 'Mute Snare', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await page.getByRole('tab', { name: 'Piano roll' }).click()
  await page.screenshot({ path: test.info().outputPath('piano-roll.png') })

  // Piano roll: clicking the grid adds a note, clicking the note removes it.
  const notes = page.getByRole('button', { name: /^Note / })
  const before = await notes.count()
  expect(before).toBe(4) // the demo 808 line
  // Click one row (14 px) above the first note: an empty cell inside the visible grid.
  const first = (await notes.first().boundingBox())!
  await page.mouse.click(first.x + 5, first.y - 7)
  await expect(notes).toHaveCount(before + 1)
  await notes.first().click() // select
  await page.keyboard.press('Delete')
  await expect(notes).toHaveCount(before)

  // And it still plays after reopening.
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.getByLabel('Playhead position')).not.toHaveText('1.1.1', { timeout: 5000 })
  await page.getByRole('button', { name: 'Stop', exact: true }).click()

  expect(consoleErrors).toEqual([])
})
