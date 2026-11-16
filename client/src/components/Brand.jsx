// Brand.jsx - the FormLens wordmark: a small lens mark plus the name. Used on the login page and the top bar.
export default function Brand({ size = 'bar' }) {
  return (
    <span className={`brand-mark brand-${size}`}>
      <svg viewBox="0 0 32 32" width="1em" height="1em" aria-hidden="true" focusable="false">
        <circle cx="14" cy="14" r="9" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="M21 21l7 7" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
        <rect x="9.5" y="10" width="9" height="2.6" rx="1.3" fill="currentColor" />
        <rect x="9.5" y="15" width="6" height="2.6" rx="1.3" fill="currentColor" />
      </svg>
      <span className="brand-name">Form<b>Lens</b></span>
    </span>
  );
}
