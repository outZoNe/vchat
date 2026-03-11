import {
  Box,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerOverlay,
  SkeletonText,
  Text,
  useMediaQuery,
  VStack,
} from '@chakra-ui/react';
import { useDispatch, useSelector } from 'react-redux';
import { useSignaling } from '../hooks/useSignaling';
import { APP_COLORS, SIZES } from '../utils/theme';
import { updateStateByPath } from '../store/actions';

const LeftBar = () => {
  const dispatch = useDispatch();
  const menuIsOpen = useSelector((s) => s.menuIsOpen);
  const rooms = useSelector((s) => s.rooms || []);
  const wsConnected = useSelector((s) => s.wsConnected || false);
  const currentRoom = useSelector((s) => s.currentRoom);
  const [isDesktop] = useMediaQuery(`(min-width: ${SIZES.BREAKPOINT_DESKTOP}px)`);
  const { joinRoom } = useSignaling();

  const toggleMenu = () => dispatch(updateStateByPath('menuIsOpen', !menuIsOpen));

  const content = (
    <Box
      className="no-select"
      position={isDesktop ? 'fixed' : 'relative'}
      left={0}
      top={isDesktop ? SIZES.HEADER_HEIGHT : '0px'}
      height={isDesktop ? `calc(100vh - ${SIZES.HEADER_HEIGHT})` : '100%'}
      color={APP_COLORS.TEXT_PRIMARY}
      width={isDesktop ? SIZES.SIDEBAR_WIDTH : '100%'}
      backgroundColor={APP_COLORS.BACKGROUND_PRIMARY}
      transform={isDesktop && !menuIsOpen ? 'translateX(-100%)' : undefined}
      transition={isDesktop ? 'transform 0.2s ease' : undefined}
    >
      <Box
        padding={4}
        height="100%"
        display="flex"
        flexDirection="column"
      >
        <Box
          marginBottom={4}
          flexShrink={0}
        >
          <strong>Комнаты</strong>
          <Box
            fontSize="xs"
            color={wsConnected ? 'green.400' : 'red.400'}
          >
            ● {wsConnected ? 'Подключено' : 'Отключено'}
          </Box>
        </Box>

        {wsConnected && rooms.length > 0 ? (
          <Box
            overflowY="auto"
            flex="1"
            paddingRight={2}
            css={{
              '&::-webkit-scrollbar': { width: '3px' },
              '&::-webkit-scrollbar-track': { background: 'transparent' },
              '&::-webkit-scrollbar-thumb': { background: APP_COLORS.BACKGROUND_SECONDARY, borderRadius: '3px' },
              '&::-webkit-scrollbar-thumb:hover': { background: 'gray.600' },
            }}
          >
            {rooms.map((room) => {
              const isActive = room.name === currentRoom;
              return (
                <Box
                  key={room.name}
                  cursor="pointer"
                  _hover={{ bg: 'gray.600' }}
                  padding={2}
                  marginBottom={2}
                  borderRadius={4}
                  backgroundColor={isActive ? APP_COLORS.BLURPLE : APP_COLORS.BACKGROUND_SECONDARY}
                  border={isActive ? '2px solid' : 'none'}
                  borderColor={isActive ? APP_COLORS.BLURPLE_HOVER : 'transparent'}
                  onClick={() => room.name !== currentRoom && joinRoom(room.name)}
                >
                  <Text fontWeight={isActive ? 'bold' : 'normal'}>{room.name}</Text>
                  {room.peers.length > 0 && (
                    <VStack
                      align="stretch"
                      spacing={1}
                      marginTop={2}
                      paddingTop={2}
                      borderTop="1px solid"
                      borderColor={isActive ? 'gray.400' : 'gray.600'}
                    >
                      <Text
                        fontSize="xs"
                        color={isActive ? 'gray.300' : 'gray.400'}
                        fontWeight="bold"
                      >
                        Участники:
                      </Text>
                      {room.peers.map((peer, i) => (
                        <Text
                          key={peer?.name + peer?.id ?? i}
                          fontSize="xs"
                          color={isActive ? 'gray.200' : 'gray.500'}
                          paddingLeft={2}
                        >
                          • {peer.name}
                        </Text>
                      ))}
                    </VStack>
                  )}
                </Box>
              );
            })}
          </Box>
        ) : (
          <Box
            fontSize="sm"
            color="gray.400"
          >
            <Text marginBottom={4}>Загрузка комнат...</Text>
            <SkeletonText
              noOfLines={5}
              gap={16}
              spacing={4}
              skeletonHeight={2}
              startColor="white"
              endColor="gray"
            />
          </Box>
        )}
      </Box>
    </Box>
  );

  if (isDesktop) return content;

  return (
    <Drawer
      isOpen={menuIsOpen}
      placement="left"
      onClose={toggleMenu}
      size="xs"
    >
      <DrawerOverlay />
      <DrawerContent bg={APP_COLORS.BACKGROUND_PRIMARY}>
        <DrawerCloseButton color={APP_COLORS.TEXT_PRIMARY} size="lg" zIndex={2} />
        <DrawerBody p={0} pt={10}>{content}</DrawerBody>
      </DrawerContent>
    </Drawer>
  );
};

export default LeftBar;
