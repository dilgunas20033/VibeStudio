import type { ClassChoice } from '../../project/drums'

export const CLASS_COLORS: Record<ClassChoice, string> = {
  kick: '#f0596b',
  snare: '#f5b84a',
  clap: '#f58f4a',
  hihat: '#3ecf8e',
  openhat: '#2fb7a0',
  perc: '#4ab3f5',
  ignore: '#646b7c',
}
export const CLASS_LETTER: Record<ClassChoice, string> = {
  kick: 'K',
  snare: 'S',
  clap: 'C',
  hihat: 'H',
  openhat: 'O',
  perc: 'P',
  ignore: '×',
}
