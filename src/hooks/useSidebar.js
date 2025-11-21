import {useCallback, useEffect, useRef, useState} from 'react';

/**
 * Хук для управления состоянием sidebar
 */
export function useSidebar(connected) {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    // Проверяем, является ли экран мобильным при загрузке
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 768;
    }
    return true;
  });

  const sidebarRef = useRef(null);
  const burgerMenuRef = useRef(null);

  // Закрываем sidebar при подключении к комнате
  useEffect(() => {
    if (connected) {
      setSidebarOpen(false);
    }
  }, [connected]);

  // Автоматически открываем/закрываем sidebar в зависимости от размера экрана (только если подключены)
  useEffect(() => {
    const handleResize = () => {
      if (!connected) {
        return;
      }

      if (window.innerWidth < 768) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [connected]);

  // Закрываем sidebar при клике вне его
  useEffect(() => {
    if (!sidebarOpen || !connected) {
      return;
    }

    const handleClickOutside = (event) => {
      // Не закрываем, если кликнули на sidebar или burger menu
      if (
        sidebarRef.current &&
        sidebarRef.current.contains(event.target)
      ) {
        return;
      }

      if (
        burgerMenuRef.current &&
        burgerMenuRef.current.contains(event.target)
      ) {
        return;
      }

      // На экранах >= 1024px не закрываем sidebar при клике вне его
      const screenWidth = window.innerWidth;
      if (screenWidth >= 1024) {
        return;
      }

      setSidebarOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [sidebarOpen, connected]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  return {
    sidebarOpen,
    setSidebarOpen,
    toggleSidebar,
    closeSidebar,
    sidebarRef,
    burgerMenuRef
  };
}

