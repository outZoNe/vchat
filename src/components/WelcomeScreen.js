import React, { useState, useEffect } from 'react';
import { CONFIG } from '../config';
import './WelcomeScreen.css';

export function WelcomeScreen({ onConnect, onUsernameSave }) {
  const [username, setUsername] = useState('');

  useEffect(() => {
    const savedUsername = localStorage.getItem(CONFIG.USERNAME.storageKey) || CONFIG.USERNAME.default;
    setUsername(savedUsername);
  }, []);

  const handleSaveUsername = () => {
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

  const handleConnect = () => {
    handleSaveUsername();
    if (onConnect) {
      onConnect();
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSaveUsername();
    }
  };

  return (
    <div className="welcome-screen">
      <div className="welcome-content">
        <h1>Добро пожаловать в VChat!</h1>
        <p className="welcome-description">Видеочат для общения с друзьями и коллегами</p>
        <div className="username-inputs-welcome">
          <input
            type="text"
            id="usernameInputWelcome"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Введите имя (1-15 символов)"
            maxLength={15}
            aria-label="Имя пользователя"
          />
          <button 
            id="saveUsernameBtnWelcome" 
            className="saveUsernameBtn-input"
            onClick={handleSaveUsername}
          >
            Сохранить
          </button>
        </div>
        <button id="connectBtn" className="connect-button" onClick={handleConnect}>
          Подключиться
        </button>
      </div>
    </div>
  );
}

