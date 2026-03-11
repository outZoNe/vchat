import { Box, Button, Text, VStack } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';
import { useSelector } from 'react-redux';

const glitch = keyframes`
  0% {
    text-shadow: 2px 0 #ff0000, -2px 0 #00ffff;
  }
  20% {
    text-shadow: -3px 1px #ff0000, 3px -1px #00ffff;
  }
  40% {
    text-shadow: 3px -2px #ff0000, -3px 2px #00ffff;
  }
  60% {
    text-shadow: -2px 2px #ff0000, 2px -2px #00ffff;
  }
  80% {
    text-shadow: 1px -1px #ff0000, -1px 1px #00ffff;
  }
  100% {
    text-shadow: 2px 0 #ff0000, -2px 0 #00ffff;
  }
`;

const blink = keyframes`
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
`;

const pulse = keyframes`
  0%, 100% {
    border-color: #00ff41;
    box-shadow: 0 0 5px #00ff41, inset 0 0 5px rgba(0, 255, 65, 0.1);
    transform: translateY(0);
  }
  25% {
    transform: translateY(-4px);
  }
  50% {
    border-color: #00cc33;
    box-shadow: 0 0 20px #00ff41, inset 0 0 10px rgba(0, 255, 65, 0.2);
    transform: translateY(0);
  }
  75% {
    transform: translateY(-3px);
  }
`;

const scanline = keyframes`
  0% {
    transform: translateY(-100%);
  }
  100% {
    transform: translateY(100vh);
  }
`;

const flicker = keyframes`
  0% {
    opacity: 0.97;
  }
  5% {
    opacity: 0.95;
  }
  10% {
    opacity: 0.97;
  }
  15% {
    opacity: 0.93;
  }
  20% {
    opacity: 0.97;
  }
  50% {
    opacity: 0.96;
  }
  80% {
    opacity: 0.98;
  }
  90% {
    opacity: 0.94;
  }
  100% {
    opacity: 0.97;
  }
`;

const TERMINAL_GREEN = '#00ff41';
const DARK_GREEN = '#003b00';
const WARNING_RED = '#ff0000';

const UpdateMessage = () => {
  const clientVersion = useSelector((s) => s.clientVersion);

  return (
    <Box
      width="100vw"
      height="100vh"
      bg="#0a0a0a"
      display="flex"
      alignItems="center"
      justifyContent="center"
      fontFamily="'Courier New', Courier, monospace"
      color={TERMINAL_GREEN}
      position="relative"
      overflow="hidden"
      animation={`${flicker} 4s infinite`}
      sx={{
        '&::after': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background:
            'repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 1px, transparent 1px, transparent 3px)',
          pointerEvents: 'none',
          zIndex: 2,
        },
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '4px',
          background: 'linear-gradient(to bottom, rgba(0,255,65,0.1), transparent)',
          animation: `${scanline} 6s linear infinite`,
          pointerEvents: 'none',
          zIndex: 3,
        },
      }}
    >
      <VStack
        spacing={6}
        zIndex={1}
        maxW="600px"
        px={6}
        textAlign="center"
      >
        <Text
          fontSize={{ base: 'xs', md: 'sm' }}
          color={DARK_GREEN}
          letterSpacing="4px"
          whiteSpace="pre"
          lineHeight="1"
        >
          {'░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░'}
        </Text>

        <Text
          fontSize={{ base: 'lg', md: '2xl' }}
          fontWeight="bold"
          letterSpacing="6px"
          textShadow={`0 0 10px ${TERMINAL_GREEN}, 0 0 20px ${TERMINAL_GREEN}, 0 0 40px ${TERMINAL_GREEN}`}
          animation={`${glitch} 2.5s infinite`}
        >
          {'[ SYSTEM ALERT ]'}
        </Text>

        <Text
          fontSize={{ base: 'xs', md: 'sm' }}
          color={DARK_GREEN}
          letterSpacing="4px"
          whiteSpace="pre"
          lineHeight="1"
        >
          {'░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░'}
        </Text>

        <Text
          fontSize={{ base: 'md', md: 'xl' }}
          fontWeight="bold"
          color={WARNING_RED}
          animation={`${blink} 1.2s step-end infinite`}
          textShadow={`0 0 8px ${WARNING_RED}, 0 0 16px ${WARNING_RED}`}
        >
          {'⚠ CRITICAL WARNING ⚠'}
        </Text>

        <Box
          border="1px solid"
          borderColor={DARK_GREEN}
          p={{ base: 4, md: 6 }}
          bg="rgba(0, 255, 65, 0.03)"
          w="100%"
        >
          <VStack
            spacing={3}
            align="flex-start"
          >
            <Text
              fontSize={{ base: 'sm', md: 'md' }}
              textShadow={`0 0 5px ${TERMINAL_GREEN}`}
            >
              {'> Версия приложения устарела.'}
            </Text>
            <Text
              fontSize={{ base: 'sm', md: 'md' }}
              textShadow={`0 0 5px ${TERMINAL_GREEN}`}
            >
              {'> Обнаружена критическая уязвимость.'}
            </Text>
            <Text
              fontSize={{ base: 'sm', md: 'md' }}
              fontWeight="bold"
              textShadow={`0 0 5px ${TERMINAL_GREEN}`}
            >
              <p>{'> НЕОБХОДИМО НЕМЕДЛЕННОЕ ОБНОВЛЕНИЕ!'}</p>
              <Text
                color={WARNING_RED}
                fontSize={{ base: 'xl', md: 'xl' }}
                textShadow={`0 0 5px ${WARNING_RED}`}
              >
                Ваша версия: {process.env.REACT_APP_CLIENT_VERSION}
              </Text>
              <Text
                color={WARNING_RED}
                fontSize={{ base: 'xl', md: 'xl' }}
                textShadow={`0 0 5px ${WARNING_RED}`}
              >
                А надо: {clientVersion}
              </Text>
            </Text>
          </VStack>
        </Box>

        <VStack spacing={3}>
          <Text
            fontSize={{ base: 'xs', md: 'sm' }}
            color={DARK_GREEN}
            textShadow={`0 0 3px ${DARK_GREEN}`}
          >
            {'Скачать новую версию:'}
          </Text>

          <Button
            as="a"
            href={`https://${process.env.REACT_APP_DOMAIN}/apps`}
            target="_blank"
            variant="unstyled"
            display="flex"
            cursor="pointer"
            fontFamily="'Courier New', Courier, monospace"
            fontSize={{ base: 'sm', md: 'md' }}
            fontWeight="bold"
            color={TERMINAL_GREEN}
            bg="transparent"
            border="2px solid"
            borderColor={TERMINAL_GREEN}
            borderRadius="0"
            px={8}
            py={3}
            h="auto"
            letterSpacing="2px"
            textShadow={`0 0 5px ${TERMINAL_GREEN}`}
            animation={`${pulse} 2s ease-in-out infinite`}
            _hover={{
              bg: TERMINAL_GREEN,
              color: '#0a0a0a',
              textShadow: 'none',
              boxShadow: `0 0 30px ${TERMINAL_GREEN}, 0 0 60px rgba(0, 255, 65, 0.3)`,
            }}
            transition="all 0.2s"
          >
            {'> DOWNLOAD_UPDATE.exe'}
          </Button>
        </VStack>

        <Text
          fontSize="xs"
          color={TERMINAL_GREEN}
          animation={`${blink} 2s step-end infinite`}
          textShadow={`0 0 5px ${TERMINAL_GREEN}`}
          mt={2}
        >
          {'[ ОЖИДАНИЕ ДЕЙСТВИЯ ПОЛЬЗОВАТЕЛЯ... ]'}
        </Text>

        <Text
          fontSize="xs"
          color={DARK_GREEN}
          letterSpacing="4px"
          whiteSpace="pre"
          lineHeight="1"
        >
          {'░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░'}
        </Text>
      </VStack>
    </Box>
  );
};

export default UpdateMessage;
