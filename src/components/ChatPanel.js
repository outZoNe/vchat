import { Box, Flex, IconButton, Image, Link, Text, Textarea, VStack } from '@chakra-ui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { FaFileAlt, FaPaperclip, FaPaperPlane, FaTimes } from 'react-icons/fa';
import { APP_COLORS } from '../utils/theme';
import { WS } from '../services/WebSocketManager';

const URL_REGEX = /(https?:\/\/[^\s<]+)/g;

const Linkify = ({ children }) => {
  if (typeof children !== 'string') return children;
  const parts = children.split(URL_REGEX);
  return parts.map((part, i) =>
    URL_REGEX.test(part) ? (
      <Link
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        color={APP_COLORS.BLURPLE}
        _hover={{ textDecoration: 'underline' }}
      >
        {part}
      </Link>
    ) : (
      part
    )
  );
};

const CHAT_WIDTH = '350px';
const API_BASE = '/api';
const MAX_FILES = 10;
const MAX_FILE_SIZE = 50 * 1024 * 1024;

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const formatTime = (dateStr) => {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatSize = (bytes) => {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
};

const AttachmentView = ({ att }) => {
  const isImage = IMAGE_TYPES.includes(att.mimeType);

  if (isImage) {
    return (
      <Link
        href={att.url}
        target="_blank"
      >
        <Image
          src={att.url}
          alt={att.filename}
          maxH="150px"
          maxW="100%"
          borderRadius="6px"
          mt={1}
          cursor="pointer"
          objectFit="cover"
        />
      </Link>
    );
  }

  return (
    <Link
      href={att.url}
      target="_blank"
      display="flex"
      alignItems="center"
      gap={2}
      mt={1}
      p={2}
      bg={APP_COLORS.BACKGROUND_TERTIARY}
      borderRadius="6px"
      _hover={{ bg: APP_COLORS.BACKGROUND_SECONDARY }}
      fontSize="xs"
      color={APP_COLORS.TEXT_PRIMARY}
    >
      <FaFileAlt color={APP_COLORS.TEXT_SECONDARY} />
      <Box flex={1} overflow="hidden">
        <Text
          isTruncated
          fontSize="xs"
        >
          {att.filename}
        </Text>
        <Text
          fontSize="10px"
          color={APP_COLORS.TEXT_SECONDARY}
        >
          {formatSize(att.size)}
        </Text>
      </Box>
    </Link>
  );
};

const ChatPanel = ({ isOpen }) => {
  const currentRoom = useSelector((s) => s.currentRoom);
  const userName = useSelector((s) => s.userName);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const dragCounterRef = useRef(0);

  const loadHistory = useCallback(async (roomName) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/messages?roomName=${encodeURIComponent(roomName)}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    } catch (e) {
      console.error('Failed to load chat history:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!currentRoom) {
      setMessages([]);
      return;
    }
    loadHistory(currentRoom);
  }, [currentRoom, loadHistory]);

  useEffect(() => {
    const unsub = WS.subscribe((msg) => {
      if (msg.type === 'chatMessage' && msg.data) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.data.id)) return prev;
          return [...prev, msg.data];
        });
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addFiles = useCallback((files) => {
    if (!files.length) return;
    setSelectedFiles((prev) => {
      const combined = [...prev, ...files].slice(0, MAX_FILES);
      return combined.filter((f) => f.size <= MAX_FILE_SIZE);
    });
  }, []);

  const handleFileSelect = (e) => {
    addFiles(Array.from(e.target.files || []));
    e.target.value = '';
  };

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  }, [addFiles]);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);
    addFiles(Array.from(e.dataTransfer.files || []));
  }, [addFiles]);

  const removeFile = (index) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const sendMessage = useCallback(async () => {
    const text = inputText.trim();
    if ((!text && selectedFiles.length === 0) || !currentRoom) return;

    if (selectedFiles.length > 0) {
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('roomName', currentRoom);
        formData.append('username', userName || 'Anonymous');
        if (text) formData.append('text', text);
        selectedFiles.forEach((f) => formData.append('files', f));

        const res = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          console.error('Upload failed:', err);
          return;
        }
      } catch (e) {
        console.error('Upload error:', e);
        return;
      } finally {
        setUploading(false);
      }
      setSelectedFiles([]);
      setInputText('');
    } else {
      WS.send({ type: 'sendChatMessage', data: { text } });
      setInputText('');
    }
  }, [inputText, selectedFiles, currentRoom, userName]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!isOpen) return null;

  return (
    <Flex
      direction="column"
      width={CHAT_WIDTH}
      minWidth={CHAT_WIDTH}
      height="calc(100vh - 60px)"
      bg={APP_COLORS.BACKGROUND_PRIMARY}
      borderLeft={`1px solid ${APP_COLORS.BACKGROUND_SECONDARY}`}
      position="relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <Flex
          position="absolute"
          inset={0}
          zIndex={10}
          bg="rgba(124, 107, 240, 0.15)"
          border={`2px dashed ${APP_COLORS.BLURPLE}`}
          borderRadius="8px"
          align="center"
          justify="center"
          pointerEvents="none"
        >
          <Text
            color={APP_COLORS.BLURPLE}
            fontWeight="bold"
            fontSize="sm"
          >
            Перетащите файлы сюда
          </Text>
        </Flex>
      )}
      <Box
        p={3}
        borderBottom={`1px solid ${APP_COLORS.BACKGROUND_SECONDARY}`}
        flexShrink={0}
      >
        <Text
          fontSize="sm"
          fontWeight="bold"
          color={APP_COLORS.TEXT_PRIMARY}
        >
          Чат
        </Text>
      </Box>

      <VStack
        flex={1}
        overflowY="auto"
        p={3}
        spacing={2}
        align="stretch"
        sx={{
          '&::-webkit-scrollbar': { width: '6px' },
          '&::-webkit-scrollbar-thumb': {
            bg: APP_COLORS.BACKGROUND_SECONDARY_LIGHT,
            borderRadius: '3px',
          },
        }}
      >
        {loading && (
          <Text
            fontSize="xs"
            color={APP_COLORS.TEXT_SECONDARY}
            textAlign="center"
          >
            Загрузка...
          </Text>
        )}
        {!loading && messages.length === 0 && (
          <Text
            fontSize="xs"
            color={APP_COLORS.TEXT_SECONDARY}
            textAlign="center"
            mt={4}
          >
            Сообщений пока нет
          </Text>
        )}
        {messages.map((msg) => (
          <Box key={msg.id}>
            <Flex
              align="baseline"
              gap={2}
            >
              <Text
                fontSize="xs"
                fontWeight="bold"
                color={APP_COLORS.BLURPLE}
              >
                {msg.username}
              </Text>
              <Text
                fontSize="10px"
                color={APP_COLORS.TEXT_SECONDARY}
              >
                {formatTime(msg.createdAt)}
              </Text>
            </Flex>
            {msg.text && (
              <Text
                fontSize="sm"
                color={APP_COLORS.TEXT_PRIMARY}
                wordBreak="break-word"
                whiteSpace="pre-wrap"
              >
                <Linkify>{msg.text}</Linkify>
              </Text>
            )}
            {msg.attachments?.map((att) => (
              <AttachmentView
                key={att.id}
                att={att}
              />
            ))}
          </Box>
        ))}
        <div ref={bottomRef} />
      </VStack>

      {/* Превью выбранных файлов */}
      {selectedFiles.length > 0 && (
        <Box
          px={3}
          py={2}
          borderTop={`1px solid ${APP_COLORS.BACKGROUND_SECONDARY}`}
          maxH="120px"
          overflowY="auto"
        >
          {selectedFiles.map((file, i) => (
            <Flex
              key={i}
              align="center"
              gap={2}
              py={1}
            >
              <FaFileAlt
                size={12}
                color={APP_COLORS.TEXT_SECONDARY}
              />
              <Text
                fontSize="xs"
                color={APP_COLORS.TEXT_PRIMARY}
                flex={1}
                isTruncated
              >
                {file.name}
                <Text
                  as="span"
                  color={APP_COLORS.TEXT_SECONDARY}
                  ml={1}
                >
                  ({formatSize(file.size)})
                </Text>
              </Text>
              <FaTimes
                size={10}
                cursor="pointer"
                color={APP_COLORS.TEXT_SECONDARY}
                onClick={() => removeFile(i)}
              />
            </Flex>
          ))}
        </Box>
      )}

      {/* Ввод сообщения */}
      <Flex
        p={3}
        gap={2}
        borderTop={`1px solid ${APP_COLORS.BACKGROUND_SECONDARY}`}
        flexShrink={0}
        align="flex-end"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
        <IconButton
          size="sm"
          variant="outline"
          icon={<FaPaperclip />}
          onClick={() => fileInputRef.current?.click()}
          color={selectedFiles.length > 0 ? APP_COLORS.BLURPLE : APP_COLORS.TEXT_SECONDARY}
          _hover={{ color: APP_COLORS.BLURPLE_HOVER, borderColor: APP_COLORS.BLURPLE_HOVER }}
          aria-label="Прикрепить файл"
          isDisabled={uploading}
        />
        <Textarea
          size="sm"
          placeholder="Написать сообщение..."
          rows={1}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          bg={APP_COLORS.BACKGROUND_TERTIARY}
          border="none"
          fontSize="14px"
          color={APP_COLORS.TEXT_PRIMARY}
          _placeholder={{ color: APP_COLORS.TEXT_SECONDARY }}
          _focus={{ boxShadow: 'none', border: `1px solid ${APP_COLORS.BLURPLE}` }}
          borderRadius="6px"
          maxLength={2000}
          isDisabled={uploading}
        />
        <IconButton
          size="sm"
          icon={<FaPaperPlane />}
          onClick={sendMessage}
          bg={APP_COLORS.BLURPLE}
          color="white"
          _hover={{ bg: APP_COLORS.BLURPLE_HOVER }}
          borderRadius="6px"
          isDisabled={(!inputText.trim() && selectedFiles.length === 0) || uploading}
          isLoading={uploading}
          aria-label="Отправить"
        />
      </Flex>
    </Flex>
  );
};

export default ChatPanel;
