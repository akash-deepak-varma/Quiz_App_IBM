export function LoadingIndicator({ label = 'Loading...', fullPage = false }) {
  return <p className={fullPage ? 'p-6 text-slate-500' : 'text-sm text-slate-400'}>{label}</p>;
}

export function ErrorBanner({ message }) {
  return <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{message}</p>;
}

export function PageError({ message }) {
  return <p className="p-6 text-red-600">{message}</p>;
}

// The project has no toast library, so a save confirmation needs somewhere to live. Mirrors
// ErrorBanner exactly, which keeps the two reading as a pair at every call site.
export function SuccessBanner({ message }) {
  return <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">{message}</p>;
}
