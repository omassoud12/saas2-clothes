import React from 'react';
import ReactDOM from 'react-dom/client';
import BusinessDaily from './pages/BusinessDaily.jsx';
import './styles/tokens.css';
import './styles/business.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BusinessDaily />
  </React.StrictMode>
);
