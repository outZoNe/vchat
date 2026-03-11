import {
  AbsoluteCenter,
  Box,
  Button,
  Divider,
  HStack,
  Input,
  InputGroup,
  InputLeftElement,
  Switch,
  Text,
  useMediaQuery,
  VStack,
} from '@chakra-ui/react';
import { LuUser } from 'react-icons/lu';
import { APP_COLORS, SIZES } from '../utils/theme';
import { updateState, updateStateByPath } from '../store/actions';
import { useCallback, useEffect, useState } from 'react';
import { keyCodeToAccelerator, showToast } from '../utils/helper';
import { useDispatch, useSelector } from 'react-redux';
import { useSignaling } from '../hooks/useSignaling';

const blurpleBtn = {
  backgroundColor: APP_COLORS.BLURPLE,
  color: APP_COLORS.TEXT_PRIMARY,
  _hover: { backgroundColor: APP_COLORS.BLURPLE_HOVER },
};

const inputBorder = { borderColor: APP_COLORS.BACKGROUND_TERTIARY };

const Chapter = ({ text }) => (
  <Box
    position="relative"
    paddingY="5"
  >
    <Divider />
    <AbsoluteCenter
      bg={APP_COLORS.BACKGROUND_PRIMARY}
      px="2"
      fontSize="sm"
      color={APP_COLORS.TEXT_SECONDARY}
    >
      {text}
    </AbsoluteCenter>
  </Box>
);

const Settings = ({ onClose }) => {
  const dispatch = useDispatch();
  const storeUserName = useSelector((s) => s.userName);
  const echoCancellation = useSelector((s) => s.echoCancellation);
  const muteMicKey = useSelector((s) => s.muteMicKey);
  const mutePeersKey = useSelector((s) => s.mutePeersKey);
  const switchScreen = useSelector((s) => s.switchScreen);
  const [userName, setUserName] = useState(storeUserName || '');
  const [recordingKey, setRecordingKey] = useState(null);
  const { sendMessage } = useSignaling();
  const [isDesktop] = useMediaQuery(`(min-width: ${SIZES.BREAKPOINT_DESKTOP}px)`);

  useEffect(() => {
    if (storeUserName) setUserName(storeUserName);
  }, [storeUserName]);

  useEffect(() => {
    if (!recordingKey) return;

    const handleKeyDown = (e) => {
      e.preventDefault();
      const newCode = e.code;

      if ([muteMicKey, mutePeersKey, switchScreen].includes(newCode)) {
        showToast({ title: 'Ошибка', description: 'Эта клавиша уже используется', status: 'error' });
        setRecordingKey(null);
        return;
      }

      dispatch(updateStateByPath(recordingKey, newCode));
      setRecordingKey(null);

      if (window.electronAPI) {
        const updated = { muteMicKey, mutePeersKey, switchScreen, [recordingKey]: newCode };
        window.electronAPI.registerShortcuts({
          muteMic: keyCodeToAccelerator(updated.muteMicKey),
          mutePeers: keyCodeToAccelerator(updated.mutePeersKey),
          switchScreen: keyCodeToAccelerator(updated.switchScreen),
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [recordingKey, muteMicKey, mutePeersKey, switchScreen, dispatch]);

  const handleUserNameChange = useCallback(() => {
    const trimmed = userName.trim();

    if (trimmed.length < 1 || trimmed.length > 12) {
      showToast({ title: 'Ошибка', description: 'Имя должено быть от 1 до 12 символов', status: 'error' });
      return;
    }

    dispatch(updateStateByPath('userName', trimmed));
    sendMessage({ type: 'userNameChanged', userName: trimmed });
    if (!isDesktop) onClose();
  }, [userName, dispatch, sendMessage, isDesktop, onClose]);

  const handleInputKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter') handleUserNameChange();
    },
    [handleUserNameChange]
  );

  const HotkeyRow = ({ label, statePath, value }) => (
    <HStack
      justify="space-between"
      width="100%"
    >
      <Text>{label}</Text>
      <Button
        size="sm"
        onClick={() => setRecordingKey(statePath)}
        {...blurpleBtn}
      >
        {recordingKey === statePath ? 'Нажмите клавишу...' : value}
      </Button>
    </HStack>
  );

  return (
    <VStack
      spacing={2}
      alignItems="left"
      gap={2}
    >
      <Chapter text="Персональные" />
      <Text>Ваше имя</Text>
      <HStack
        spacing={2}
        width="100%"
        paddingBottom={8}
      >
        <InputGroup>
          <InputLeftElement pointerEvents="none">
            <LuUser />
          </InputLeftElement>
          <Input
            backgroundColor={APP_COLORS.BACKGROUND_SECONDARY}
            placeholder="Ваше имя"
            name="username"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            onKeyDown={handleInputKeyDown}
            outline="none"
            borderColor={APP_COLORS.BACKGROUND_SECONDARY}
            _hover={inputBorder}
            _active={inputBorder}
            _focus={inputBorder}
          />
        </InputGroup>
        <Button
          onClick={handleUserNameChange}
          {...blurpleBtn}
        >
          Сохранить
        </Button>
      </HStack>
      <Chapter text="Аппаратное" />
      <HStack>
        <Switch
          isChecked={echoCancellation}
          onChange={(e) => dispatch(updateState({ echoCancellation: e.target.checked }))}
        />
        <Text>Шумоподавление</Text>
      </HStack>
      <Chapter text="Горячие клавиши" />
      <VStack
        spacing={3}
        align="stretch"
        pb={6}
      >
        <Text
          fontSize={'xs'}
          style={{
            color: APP_COLORS.GREEN,
            fontWeight: 'bold',
          }}
        >
          Убедитесь, что у вас включен режим NumLock на клавиатуре
        </Text>
        <HotkeyRow
          label="Микрофон"
          statePath="muteMicKey"
          value={muteMicKey}
        />
        <HotkeyRow
          label="Отключить всех"
          statePath="mutePeersKey"
          value={mutePeersKey}
        />
        <HotkeyRow
          label="Демонстрация экрана"
          statePath="switchScreen"
          value={switchScreen}
        />
      </VStack>
    </VStack>
  );
};

export default Settings;
