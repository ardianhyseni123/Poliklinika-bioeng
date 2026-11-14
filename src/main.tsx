import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SessionProvider } from './auth/session';
import { UpdateGate } from './features/update/UpdateGate';
import './styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element.');

createRoot(root).render(
  <StrictMode>
    <UpdateGate>
      <SessionProvider>
        <App />
      </SessionProvider>
    </UpdateGate>
  </StrictMode>
);
