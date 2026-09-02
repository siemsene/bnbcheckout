import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './state/motionStore'; // sets data-motion on <html> before first paint
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
