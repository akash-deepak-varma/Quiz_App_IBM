export function LoadingIndicator({ label = 'Loading...', fullPage = false }) {
  return <p className={fullPage ? 'p-6 text-slate-500' : 'text-sm text-slate-400'}>{label}</p>;
}

export function ErrorBanner({ message }) {
  return <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{message}</p>;
}

export function PageError({ message }) {
  return <p className="p-6 text-red-600">{message}</p>;
}
