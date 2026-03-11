import { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { updateStateByPath } from '../store/actions';
import { SIZES } from '../utils/theme';

export const useMenuToggle = () => {
  const dispatch = useDispatch();
  const prevWidthRef = useRef(window.innerWidth);

  useEffect(() => {
    const handleResize = () => {
      const currentWidth = window.innerWidth;
      const prevWidth = prevWidthRef.current;
      const wasDesktop = prevWidth >= SIZES.BREAKPOINT_DESKTOP;
      const isDesktop = currentWidth >= SIZES.BREAKPOINT_DESKTOP;

      // Обновляем меню только если произошел переход через порог
      if (wasDesktop !== isDesktop) {
        dispatch(updateStateByPath('menuIsOpen', isDesktop));
      }

      prevWidthRef.current = currentWidth;
    };

    // Проверяем при монтировании
    const initialWidth = window.innerWidth;
    const shouldBeOpen = initialWidth >= SIZES.BREAKPOINT_DESKTOP;
    dispatch(updateStateByPath('menuIsOpen', shouldBeOpen));
    prevWidthRef.current = initialWidth;

    // Добавляем обработчик изменения размера окна
    window.addEventListener('resize', handleResize);

    // Очистка при размонтировании
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [dispatch]);
};
