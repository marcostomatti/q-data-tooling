import { Button } from '@open-tomato/components';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<Button variant="primary">Run</Button>);
}
