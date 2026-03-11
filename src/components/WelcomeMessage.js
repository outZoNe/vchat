import { Link, Text, VStack } from '@chakra-ui/react';
import { APP_COLORS } from '../utils/theme';
import { useSelector } from 'react-redux';
import { APP_NAME } from '../utils/helper';

const WelcomeMessage = () => {
  const serverVersion = useSelector((state) => state.serverVersion);

  return (
    <VStack
      textAlign="center"
      justifyContent="center"
      color={APP_COLORS.TEXT_SECONDARY}
      margin={'0 auto'}
      minHeight="90vh"
      maxWidth="90vw"
      backgroundColor={APP_COLORS.BACKGROUND_TERTIARY}
    >
      <Text
        fontSize="2xl"
        fontWeight="bold"
      >
        Добро пожаловать в {APP_NAME}!
      </Text>
      <Text fontSize="lg">👈 Выберите комнату из списка слева, чтобы начать общение</Text>
      <Text
        fontSize="md"
        marginTop="8rem"
        fontWeight="bold"
      >
        Исходный код, если хотите:{' '}
        <Link
          color={APP_COLORS.BLURPLE_HOVER}
          href="https://github.com/outZoNe/vchat"
          target="_blank"
        >
          GitHub
        </Link>
      </Text>
      <Text
        fontSize="sm"
        color={APP_COLORS.BACKGROUND_SECONDARY_LIGHT}
      >
        Версия клиента: {process.env.REACT_APP_CLIENT_VERSION}
        <br />
        Версия сервера: {serverVersion}
      </Text>
    </VStack>
  );
};

export default WelcomeMessage;
