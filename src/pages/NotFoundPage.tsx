import { Link } from 'react-router-dom';
import { Card } from '../components/ui';

export function NotFoundPage({
  message = 'העמוד המבוקש אינו קיים.',
}: {
  message?: string;
}): JSX.Element {
  return (
    <Card className="mx-auto max-w-xl text-center">
      <h1 className="text-xl">לא נמצא</h1>
      <p className="mt-2 text-sm text-ink-2">{message}</p>
      <Link className="btn btn-primary mt-4" to="/">
        חזרה לדף הבית
      </Link>
    </Card>
  );
}
