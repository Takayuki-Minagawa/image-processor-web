export const stripControlCharacters = (value: string): string =>
  [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0
      return code > 31 && code !== 127
    })
    .join('')
