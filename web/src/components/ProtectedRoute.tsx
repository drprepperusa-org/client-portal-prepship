import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function ProtectedRoute({ children }: { children: JSX.Element }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-page text-ink">
        <div className="h-8 w-8 animate-spinSlow rounded-full border-2 border-line border-t-brand" />
      </div>
    );
  }

  if (!auth.accessToken) {
    return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace state={{ from: location }} />;
  }

  return children;
}
