import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="card p-10 text-center">
      <div className="text-5xl font-bold text-[color:var(--rt-teal)] mb-2">404</div>
      <h2 className="text-xl font-semibold mb-1">Page not found</h2>
      <p className="text-sm text-slate-500 mb-4">
        The page you are looking for doesn't exist or has moved.
      </p>
      <Link to="/" className="btn-primary inline-block">
        Back to Dashboard
      </Link>
    </div>
  )
}
