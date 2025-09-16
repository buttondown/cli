export const hash = (fields: string[]): string => {
  const content = fields.join("|");

  let iterator = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    iterator = (iterator << 5) - iterator + char;
    iterator &= iterator;
  }

  return iterator.toString();
};
