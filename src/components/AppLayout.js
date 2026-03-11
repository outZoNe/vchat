import { Box } from '@chakra-ui/react';
import Header from './Header';
import Room from './Room';
import LeftBar from './LeftBar';
import { useSelector } from 'react-redux';
import { useMenuToggle } from '../hooks/useMenuToggle';
import { APP_COLORS, SIZES } from '../utils/theme';
import WelcomeMessage from './WelcomeMessage';
import UpdateMessage from './UpdateMessage';

const AppLayout = ({ children }) => {
  const currentRoom = useSelector((s) => s.currentRoom);
  const menuIsOpen = useSelector((state) => state.menuIsOpen);
  const clientVersion = useSelector((state) => state.clientVersion);

  // Автоматическое управление меню на основе ширины экрана
  useMenuToggle();

  // Проверяем, что версия "вкомпилированная в приложение" совпадает с то, которая пришла от сервере, если нет, то просим обновиться юзера
  if (!!clientVersion && clientVersion !== process.env.REACT_APP_CLIENT_VERSION) {
    return <UpdateMessage />;
  }

  return (
    <Box
      backgroundColor={APP_COLORS.BACKGROUND_TERTIARY}
      minHeight="100vh"
      color={APP_COLORS.TEXT_PRIMARY}
    >
      <Header />
      <LeftBar />
      <Box
        marginLeft={menuIsOpen ? SIZES.SIDEBAR_WIDTH : '0px'}
        transition="margin-left 0.2s ease"
      >
        {currentRoom ? <Room>{children}</Room> : <WelcomeMessage />}
      </Box>
    </Box>
  );
};

export default AppLayout;
