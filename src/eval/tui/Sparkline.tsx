import { Text } from 'ink';

const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

export function Sparkline({
  values,
  min = 0,
  max = 1,
  width = 12,
}: {
  values: number[];
  min?: number;
  max?: number;
  width?: number;
}) {
  if (values.length === 0) {
    return <Text dimColor>{' '.repeat(width)}</Text>;
  }
  const slice = values.slice(-width);
  const span = max - min || 1;
  const chars = slice.map(v => {
    const norm = Math.max(0, Math.min(1, (v - min) / span));
    const idx = Math.round(norm * (BARS.length - 1));
    return BARS[idx]!;
  });
  return <Text>{chars.join('')}</Text>;
}
