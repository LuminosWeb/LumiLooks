import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/theme.css';
import './styles/style.css';
import './styles/components.css';
import './styles/app.css';

document.documentElement.dataset.theme = localStorage.getItem('lumilooks.theme') === '"light"' ? 'light' : 'dark';
createRoot(document.getElementById('root')!).render(<App />);
