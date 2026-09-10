/**
 * In-app replacements for window.prompt / window.confirm: consistent with the
 * rest of the UI, tablet-friendly, and harder to fat-finger.
 */
import { useState } from 'react';
import Modal from './Modal';

export function TextPromptDialog({
  title,
  label,
  placeholder,
  initial = '',
  confirmLabel = 'OK',
  danger = false,
  inputMode,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  placeholder?: string;
  initial?: string;
  confirmLabel?: string;
  danger?: boolean;
  inputMode?: 'decimal' | 'numeric' | 'text';
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Modal title={title} onClose={onClose}>
      <label>{label}</label>
      <input
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && value.trim() && onSubmit(value.trim())}
        style={{ width: '100%' }}
        className="mb"
        autoFocus
      />
      <button
        className={danger ? 'danger' : 'primary'}
        disabled={!value.trim()}
        onClick={() => onSubmit(value.trim())}
      >
        {confirmLabel}
      </button>
    </Modal>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p style={{ marginTop: 0 }}>{message}</p>
      <div className="row">
        <button className={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</button>
        <button onClick={onClose}>Keep as is</button>
      </div>
    </Modal>
  );
}
