// One short definition per term. Every tooltip that explains a term reads from here, so a term is explained
// the same way on every page.

export const GLOSSARY = {
  target: 'One program to write: its prompt, its harness and its test suite.',
  variant: 'One answer of one model to one prompt: a single independently written version of the program.',
  setting: 'How the model generates: a sampling temperature with reasoning off, or reasoning on at an effort level.',
  maxTokens: 'The most tokens one answer may use, reasoning included. Longer answers are cut off.',
  budgetCap: 'The run stops before the money spent plus the worst case of the next request (its whole prompt and max_tokens of output) would pass this cap.',
  compileError: 'The code did not compile, so every test counts as failed.',
  coincidentFailure: 'Two versions fail the same test. A majority vote cannot mask such a test.',
  voting: 'Three versions answer every call; the majority answer is used.',
} as const

export type Term = keyof typeof GLOSSARY
