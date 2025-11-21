import React, { useState, useEffect } from 'react';
import { CONFIG } from '../config';
import './UsernameInput.css';

export function UsernameInput({ onSave, initialUsername }) {
  const [username, setUsername] = useState(initialUsername || '');

  useEffect(() => {
    const savedUsername = localStorage.getItem(CONFIG.USERNAME.storageKey) || CONFIG.USERNAME.default;
    setUsername(savedUsername);
  }, [initialUsername]);

  const handleSave = () => {
    const value = username.trim().slice(0, CONFIG.USERNAME.maxLength);
    if (value.length < CONFIG.USERNAME.minLength) {
      alert(`Имя должно быть от ${CONFIG.USERNAME.minLength} до ${CONFIG.USERNAME.maxLength} символов`);
      return;
    }
    localStorage.setItem(CONFIG.USERNAME.storageKey, value);
    if (onSave) {
      onSave(value);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSave();
    }
  };

  return (
    <div className="username-inputs">
      <input
        type="text"
        id="usernameInput"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        onKeyPress={handleKeyPress}
        placeholder="Введите имя (1-15 символов)"
        maxLength={15}
        aria-label="Имя пользователя"
      />
      <button 
        id="saveUsernameBtn" 
        className="saveUsernameBtn-input"
        onClick={handleSave}
      >
        Save
      </button>
    </div>
  );
}

