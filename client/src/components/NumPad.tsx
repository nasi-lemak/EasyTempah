export default function NumPad({
  onDigit,
  onClear,
  onEnter,
  enterLabel = 'OK',
}: {
  onDigit: (d: string) => void;
  onClear: () => void;
  onEnter?: () => void;
  enterLabel?: string;
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return (
    <div className="numpad">
      {keys.map((k) => (
        <button key={k} onClick={() => onDigit(k)}>
          {k}
        </button>
      ))}
      <button onClick={onClear}>C</button>
      <button onClick={() => onDigit('0')}>0</button>
      {onEnter ? (
        <button className="primary" onClick={onEnter}>
          {enterLabel}
        </button>
      ) : (
        <button disabled> </button>
      )}
    </div>
  );
}
