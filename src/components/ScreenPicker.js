import { APP_COLORS } from '../utils/theme';
import {
  Box,
  Grid,
  Image,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
} from '@chakra-ui/react';

const SourceCard = ({ source, onSelect }) => (
  <Box
    cursor="pointer"
    borderRadius="md"
    overflow="hidden"
    border="2px solid transparent"
    _hover={{ borderColor: APP_COLORS.BLURPLE, transform: 'scale(1.03)' }}
    transition="all 0.15s ease"
    bg={APP_COLORS.BACKGROUND_TERTIARY}
    onClick={() => onSelect(source)}
  >
    <Image
      src={source.thumbnailDataUrl}
      alt={source.name}
      w="100%"
      h="140px"
      objectFit="cover"
      bg="black"
    />
    <Text
      fontSize="xs"
      color={APP_COLORS.TEXT_PRIMARY}
      px={2}
      py={1.5}
      noOfLines={1}
      title={source.name}
    >
      {source.name}
    </Text>
  </Box>
);

const ScreenPicker = ({ isOpen, onClose, onSelect, sources }) => {
  const screens = sources.filter((s) => s.id.startsWith('screen:'));
  const windows = sources.filter((s) => s.id.startsWith('window:'));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="3xl"
      isCentered
    >
      <ModalOverlay bg="blackAlpha.700" />
      <ModalContent
        bg={APP_COLORS.BACKGROUND_SECONDARY}
        color={APP_COLORS.TEXT_PRIMARY}
        maxH="80vh"
      >
        <ModalHeader fontSize="md">Выберите источник для демонстрации</ModalHeader>
        <ModalCloseButton />
        <ModalBody
          pb={5}
          overflowY="auto"
        >
          <Tabs
            variant="soft-rounded"
            colorScheme="purple"
          >
            <TabList mb={3}>
              <Tab
                color={APP_COLORS.TEXT_SECONDARY}
                _selected={{ color: 'white', bg: APP_COLORS.BLURPLE }}
                fontSize="sm"
              >
                Экраны ({screens.length})
              </Tab>
              <Tab
                color={APP_COLORS.TEXT_SECONDARY}
                _selected={{ color: 'white', bg: APP_COLORS.BLURPLE }}
                fontSize="sm"
              >
                Окна ({windows.length})
              </Tab>
            </TabList>
            <TabPanels>
              <TabPanel px={0}>
                {screens.length === 0 ? (
                  <Text
                    color={APP_COLORS.TEXT_SECONDARY}
                    fontSize="sm"
                  >
                    Экраны не найдены
                  </Text>
                ) : (
                  <Grid
                    templateColumns="repeat(auto-fill, minmax(200px, 1fr))"
                    gap={3}
                  >
                    {screens.map((s) => (
                      <SourceCard
                        key={s.id}
                        source={s}
                        onSelect={onSelect}
                      />
                    ))}
                  </Grid>
                )}
              </TabPanel>
              <TabPanel px={0}>
                {windows.length === 0 ? (
                  <Text
                    color={APP_COLORS.TEXT_SECONDARY}
                    fontSize="sm"
                  >
                    Окна не найдены
                  </Text>
                ) : (
                  <Grid
                    templateColumns="repeat(auto-fill, minmax(200px, 1fr))"
                    gap={3}
                  >
                    {windows.map((s) => (
                      <SourceCard
                        key={s.id}
                        source={s}
                        onSelect={onSelect}
                      />
                    ))}
                  </Grid>
                )}
              </TabPanel>
            </TabPanels>
          </Tabs>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};

export default ScreenPicker;
