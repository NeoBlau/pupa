import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { initTelegram } from './tg.ts';
import './styles.css';

initTelegram();
createRoot(document.getElementById('root')!).render(<App />);
