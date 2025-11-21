import React, { useState, useEffect } from 'react';
import { CONFIG } from '../config';
import './Header.css';

export function Header({ onUsernameSave, currentUsername, onToggleSidebar, sidebarOpen, burgerMenuRef, onNoiseSuppressionChange }) {
  const [username, setUsername] = useState(currentUsername || '');
  const [noiseSuppression, setNoiseSuppression] = useState(false);

  useEffect(() => {
    const savedUsername = localStorage.getItem(CONFIG.USERNAME.storageKey) || CONFIG.USERNAME.default;
    setUsername(savedUsername);
  }, [currentUsername]);

  useEffect(() => {
    const saved = localStorage.getItem('noiseSuppressionEnabled');
    setNoiseSuppression(saved === 'true');
  }, []);

  const handleNoiseSuppressionChange = (e) => {
    const enabled = e.target.checked;
    setNoiseSuppression(enabled);
    localStorage.setItem('noiseSuppressionEnabled', enabled.toString());
    if (onNoiseSuppressionChange) {
      onNoiseSuppressionChange(enabled);
    }
  };

  const handleSave = () => {
    const value = username.trim().slice(0, CONFIG.USERNAME.maxLength);
    if (value.length < CONFIG.USERNAME.minLength) {
      alert(`Имя должно быть от ${CONFIG.USERNAME.minLength} до ${CONFIG.USERNAME.maxLength} символов`);
      return;
    }
    localStorage.setItem(CONFIG.USERNAME.storageKey, value);
    if (onUsernameSave) {
      onUsernameSave(value);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSave();
    }
  };

  return (
    <header className="app-header">
      <div className="header-content">
        <button 
          ref={burgerMenuRef}
          className="burger-menu"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
        >
          <span className={`burger-line ${sidebarOpen ? 'open' : ''}`}></span>
          <span className={`burger-line ${sidebarOpen ? 'open' : ''}`}></span>
          <span className={`burger-line ${sidebarOpen ? 'open' : ''}`}></span>
        </button>
        <div className="header-logo">
          <h1>VChat</h1>
        </div>
        <div className={`header-username ${!sidebarOpen ? 'sidebar-collapsed' : ''}`}>
          <div className="noise-suppression-control">
            <label htmlFor="noiseSuppressionCheckbox" className="noise-suppression-label">
              <input
                type="checkbox"
                id="noiseSuppressionCheckbox"
                checked={noiseSuppression}
                onChange={handleNoiseSuppressionChange}
                aria-label="Включить шумоподавление"
              />
              <span>Шумоподавление</span>
            </label>
          </div>
          <input
            type="text"
            id="headerUsernameInput"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Введите имя (1-15 символов)"
            maxLength={15}
            aria-label="Имя пользователя"
          />
          <button 
            className="header-save-btn"
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </div>
    </header>
  );
}

