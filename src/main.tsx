import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App.js'

const rootEl = document.getElementById('root')
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}
