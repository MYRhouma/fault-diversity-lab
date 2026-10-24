import { Prism } from 'prism-react-renderer'
import * as React from 'react'

// Solidity is not bundled with prism-react-renderer; this is the grammar of Prism's prism-solidity component,
// with the keywords added since Solidity 0.6 (error, override, virtual, immutable, unchecked, try, catch).
const P = Prism as unknown as {
  languages: Record<string, unknown> & {
    extend: (base: string, grammar: Record<string, unknown>) => unknown
    insertBefore: (lang: string, before: string, grammar: Record<string, unknown>) => void
  }
}
if (!P.languages.solidity) {
  P.languages.solidity = P.languages.extend('clike', {
    'class-name': { pattern: /(\b(?:contract|enum|interface|library|new|struct|using|error|event|is)\s+)(?!\d)[\w$]+/, lookbehind: true },
    keyword: /\b(?:_|abstract|anonymous|as|assembly|assert|break|calldata|case|catch|constant|constructor|continue|contract|default|delete|do|else|emit|enum|error|event|external|fallback|for|from|function|if|immutable|import|indexed|interface|internal|is|let|library|mapping|memory|modifier|new|override|payable|pragma|private|public|pure|receive|require|return|returns|revert|solidity|storage|struct|switch|this|try|type|unchecked|using|view|virtual|while)\b/,
    operator: /=>|->|:=|=:|\*\*|\+\+|--|\|\||&&|<<=?|>>=?|[-+*/%^&|<>!=]=?|[~?]/,
  })
  P.languages.insertBefore('solidity', 'keyword', {
    builtin: /\b(?:address|bool|string|bytes(?:[1-9]|[12]\d|3[0-2])?|u?int(?:8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?)\b/,
  })
  P.languages.insertBefore('solidity', 'number', {
    version: { pattern: /([<>]=?|\^)\d+\.\d+\.\d+\b/, lookbehind: true, alias: 'number' },
  })
}

// Java is not bundled either: a small clike-based grammar (keywords, annotations, class names) is enough here.
if (!P.languages.java) {
  P.languages.java = P.languages.extend('clike', {
    'class-name': /\b[A-Z]\w*\b/,
    keyword: /\b(?:abstract|boolean|break|byte|case|catch|char|class|continue|default|do|double|else|enum|extends|final|finally|float|for|if|implements|import|instanceof|int|interface|long|new|package|private|protected|public|return|short|static|super|switch|this|throw|throws|try|var|void|while)\b/,
  })
  P.languages.insertBefore('java', 'keyword', { annotation: { pattern: /@\w+/, alias: 'builtin' } })
}

export type Language = 'solidity' | 'typescript' | 'java' | 'json' | 'markdown' | 'python' | 'text'

/** Guess the language of a code block from its title (a file name) when none is given. */
export function languageOf(title: string | undefined): Language {
  const t = (title ?? '').toLowerCase()
  if (/\.sol\b/.test(t)) return 'solidity'
  if (/\.tsx?\b/.test(t)) return 'typescript'
  if (/\.py\b/.test(t)) return 'python'
  if (/\.java\b/.test(t)) return 'java'
  if (t === 'json' || /\.json\b/.test(t)) return 'json'
  if (/\.md\b/.test(t)) return 'markdown'
  return 'text'
}

/** True while the dark theme is on; follows the class that the theme switch sets on <html>. */
export function useIsDark() {
  const [dark, setDark] = React.useState(() => document.documentElement.classList.contains('dark'))
  React.useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return dark
}
