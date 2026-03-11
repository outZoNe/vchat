import {
  Box,
  Button,
  Flex,
  HStack,
  Icon,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  useDisclosure,
} from '@chakra-ui/react';
import { APP_NAME } from '../utils/helper';
import { useDispatch, useSelector } from 'react-redux';
import { updateStateByPath } from '../store/actions';
import { APP_COLORS, SIZES } from '../utils/theme';
import { IoMdInformationCircle, IoMdMenu, IoMdSettings } from 'react-icons/io';
import Settings from './Settings';
import ServerInfo from './ServerInfo';
import { FaCloudDownloadAlt } from 'react-icons/fa';

const isHolidaySeason = () => {
  const now = new Date();
  const month = now.getMonth();
  const day = now.getDate();
  return (month === 11 && day >= 20) || (month === 0 && day <= 15);
};

const Header = () => {
  const dispatch = useDispatch();
  const menuIsOpen = useSelector((state) => state.menuIsOpen);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const { isOpen: isInfoOpen, onOpen: onInfoOpen, onClose: onInfoClose } = useDisclosure();

  const toggleMenu = () => {
    dispatch(updateStateByPath('menuIsOpen', !menuIsOpen));
  };

  return (
    <Flex
      as="header"
      position="sticky"
      top={0}
      zIndex={10}
      left={0}
      width="100%"
      height={SIZES.HEADER_HEIGHT}
      backgroundColor={APP_COLORS.BACKGROUND_PRIMARY}
      color={APP_COLORS.TEXT_PRIMARY}
      fontWeight="bold"
      padding={4}
      textAlign="center"
      justifyContent="space-between"
    >
      <HStack
        userSelect={'none'}
        as={'h1'}
        cursor={'pointer'}
        _hover={{
          textShadow: '1px 1px 1px rgba(0,0,0,0)',
        }}
      >
        <Box>
          <Icon
            as={IoMdMenu}
            onClick={toggleMenu}
            boxSize={6}
            marginTop={2}
            _hover={{ color: APP_COLORS.TEXT_SECONDARY }}
            cursor={'pointer'}
          />
        </Box>
        <Box
          display="flex"
          alignItems="center"
          fontSize="1.5em"
          fontWeight="bold"
        >
          <span style={{ marginRight: 10 }}>{APP_NAME}</span>
          {isHolidaySeason() && (
            <span
              style={{
                display: 'inline-block',
                fontSize: '1.7em',
                verticalAlign: 'middle',
                filter: 'drop-shadow(0 1px 2px #2B2B2B)',
              }}
              role="img"
              aria-label="Christmas tree"
            >
              🎄
            </span>
          )}
        </Box>
      </HStack>
      <HStack
        paddingX={4}
        marginLeft={4}
      >
        {!window.electronAPI && (
          <Button
            as={'a'}
            href={'/apps'}
            target="_blank"
            variant="outline"
            cursor={'pointer'}
            size={'sm'}
            backgroundColor={APP_COLORS.BACKGROUND_PRIMARY}
            color={APP_COLORS.TEXT_PRIMARY}
            borderColor={APP_COLORS.TEXT_PRIMARY}
            _hover={{
              backgroundColor: APP_COLORS.BACKGROUND_TERTIARY,
            }}
            display={{ base: 'none', md: 'inline-flex' }}
          >
            <Icon marginRight={2}>
              <FaCloudDownloadAlt size={24} />
            </Icon>
            СКАЧАТЬ APP
          </Button>
        )}
        <Icon
          boxSize={6}
          marginRight={2}
          cursor="pointer"
          _hover={{ color: APP_COLORS.BLURPLE }}
          onClick={onInfoOpen}
          as={IoMdInformationCircle}
        />
        <Icon
          boxSize={6}
          cursor="pointer"
          _hover={{ color: APP_COLORS.BLURPLE }}
          onClick={onOpen}
          as={IoMdSettings}
        />
      </HStack>

      <Modal
        isOpen={isInfoOpen}
        onClose={onInfoClose}
        isCentered
        size="lg"
      >
        <ModalOverlay />
        <ModalContent
          backgroundColor={APP_COLORS.BACKGROUND_PRIMARY}
          color={APP_COLORS.TEXT_PRIMARY}
        >
          <ModalHeader>Состояние сервера</ModalHeader>
          <ModalCloseButton />
          <ModalBody paddingBottom={6}>
            <ServerInfo />
          </ModalBody>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={isOpen}
        onClose={onClose}
        isCentered
      >
        <ModalOverlay />
        <ModalContent
          backgroundColor={APP_COLORS.BACKGROUND_PRIMARY}
          color={APP_COLORS.TEXT_PRIMARY}
        >
          <ModalHeader>Настройки</ModalHeader>
          <ModalCloseButton />
          <ModalBody paddingBottom={6}>
            <Settings onClose></Settings>
          </ModalBody>
        </ModalContent>
      </Modal>
    </Flex>
  );
};

export default Header;
