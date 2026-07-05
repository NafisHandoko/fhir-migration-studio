import { forwardRef, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, mono, className = '', id, ...rest }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="input-group">
        {label && (
          <label className="input-label" htmlFor={inputId}>
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`input ${mono ? 'input-mono' : ''} ${error ? 'border-red-500' : ''} ${className}`.trim()}
          {...rest}
        />
        {hint && !error && (
          <span style={{ fontSize: 11, color: 'var(--color-text-subtle)' }}>{hint}</span>
        )}
        {error && (
          <span style={{ fontSize: 11, color: 'var(--color-error)' }}>{error}</span>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';
