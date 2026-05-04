import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import type { CurrentTurnDetail } from '../state.ts';
import type { Prediction } from '../../../agents/types.ts';

export function PredictorPanel({ detail }: { detail: CurrentTurnDetail | null }) {
  const running = !detail || detail.phase === 'predictor';
  const predictions = detail?.predictions;
  const chosenIndex = detail?.chosenIndex;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={running ? 'gray' : 'cyan'} paddingX={1}>
      <Box>
        <Text bold>② predictor</Text>
        {predictions && (
          <Text dimColor>  ×{predictions.length}</Text>
        )}
        {running ? (
          <>
            <Text>  </Text>
            <Spinner />
          </>
        ) : detail?.predictorMs !== undefined ? (
          <Text dimColor>  ✓ {(detail.predictorMs / 1000).toFixed(1)}s · {detail.predictorTokens} tok</Text>
        ) : null}
      </Box>
      {predictions && predictions.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>
              {' #'.padEnd(4)}
              {'cand'.padEnd(8)}
              {'Δ'.padEnd(4)}
              {'conf'.padEnd(7)}
              {'rev'.padEnd(20)}
              {'loss'.padEnd(8)}
              {'blast'.padEnd(9)}
              precond
            </Text>
          </Box>
          {predictions.map((p, i) => (
            <PredictorRow key={i} prediction={p} index={i} chosen={i === chosenIndex} />
          ))}
        </Box>
      )}
    </Box>
  );
}

function PredictorRow({
  prediction,
  index,
  chosen,
}: {
  prediction: Prediction;
  index: number;
  chosen: boolean;
}) {
  return (
    <Box>
      <Text>{chosen ? '★ ' : '  '}</Text>
      <Text>{String(index).padEnd(4)}</Text>
      <Text>{String(prediction.expected_changes.length).padEnd(8)}</Text>
      <Text>{String(prediction.expected_changes.length).padEnd(4)}</Text>
      <Text color={confColor(prediction.confidence)}>{prediction.confidence.padEnd(7)}</Text>
      <Text color={revColor(prediction.reversibility)}>{prediction.reversibility.padEnd(20)}</Text>
      <Text color={lossColor(prediction.data_loss_risk)}>{prediction.data_loss_risk.padEnd(8)}</Text>
      <Text color={blastColor(prediction.blast_radius)}>{prediction.blast_radius.padEnd(9)}</Text>
      <Text dimColor>{prediction.unverified_preconditions.length}</Text>
    </Box>
  );
}

function confColor(c: Prediction['confidence']): string {
  return c === 'high' ? 'green' : c === 'medium' ? 'yellow' : 'red';
}
function revColor(r: Prediction['reversibility']): string {
  return r === 'fully_reversible'
    ? 'green'
    : r === 'reversible_with_backup'
    ? 'green'
    : r === 'partially_reversible'
    ? 'yellow'
    : r === 'irreversible'
    ? 'red'
    : 'gray';
}
function lossColor(l: Prediction['data_loss_risk']): string {
  return l === 'none' ? 'green' : l === 'low' ? 'yellow' : 'red';
}
function blastColor(b: Prediction['blast_radius']): string {
  return b === 'narrow' ? 'green' : b === 'wide' ? 'red' : 'gray';
}
