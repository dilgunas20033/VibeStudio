import type { Page } from '@playwright/test'
import { readMidi } from './midi.ts'
import { readWav } from './wav.ts'

async function exportVia(page: Page, item: string | RegExp) {
  const download = page.waitForEvent('download', { timeout: 180_000 })
  await page.getByRole('button', { name: /^Export/ }).click()
  await page.getByRole('menuitem', { name: item }).click()
  return (await download).path()
}

export async function exportWav(page: Page) {
  return readWav(await exportVia(page, 'Audio (WAV, whole song)'))
}

export async function exportMidi(page: Page, item: string | RegExp = 'MIDI (all tracks)') {
  return readMidi(await exportVia(page, item))
}
