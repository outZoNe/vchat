import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Box, Flex, HStack, IconButton, Progress, Spinner, Text, Tooltip, VStack } from '@chakra-ui/react';
import { IoMdRefresh } from 'react-icons/io';
import { APP_COLORS } from '../utils/theme';
import { WS } from '../services/WebSocketManager';
import { APP_NAME } from '../utils/helper';

const StatCard = ({ label, value, color }) => (
  <Box
    bg={APP_COLORS.BACKGROUND_SECONDARY}
    borderRadius="md"
    p={3}
    flex="1"
    minW="100px"
  >
    <Text
      fontSize="xs"
      color={APP_COLORS.TEXT_SECONDARY}
      textTransform="uppercase"
      letterSpacing="wide"
    >
      {label}
    </Text>
    <Text
      fontSize="2xl"
      fontWeight="bold"
      color={color || APP_COLORS.TEXT_PRIMARY}
    >
      {value}
    </Text>
  </Box>
);

const WorkerRow = ({ worker }) => {
  const alive = worker.workerAlive && !worker.isDead;
  return (
    <Box
      bg={APP_COLORS.BACKGROUND_SECONDARY}
      borderRadius="md"
      p={3}
      borderLeft="3px solid"
      borderLeftColor={alive ? APP_COLORS.GREEN : APP_COLORS.RED}
    >
      <Flex
        justify="space-between"
        align="center"
        mb={2}
      >
        <HStack spacing={2}>
          <Text
            fontWeight="semibold"
            fontSize="sm"
          >
            Worker #{worker.index}
          </Text>
          <Badge colorScheme={alive ? 'green' : 'red'}>{alive ? 'active' : 'dead'}</Badge>
        </HStack>
        <Text
          fontSize="xs"
          color={APP_COLORS.TEXT_SECONDARY}
        >
          PORT:{worker.webRtcPort}
        </Text>
      </Flex>

      <VStack
        gap={4}
        fontSize="xs"
        alignItems="left"
        color={APP_COLORS.TEXT_SECONDARY}
        flexWrap="wrap"
      >
        <HStack spacing={1}>
          <Text>Активные комнаты:</Text>
          <Text color={APP_COLORS.TEXT_PRIMARY}>{worker.rooms.join(', ')}</Text>
        </HStack>
        <HStack spacing={1}>
          <Text>Транспорты:</Text>
          <Text color={APP_COLORS.TEXT_PRIMARY}>{worker.transportsCount}</Text>
        </HStack>
        {worker.restartAttempts > 0 && (
          <HStack spacing={1}>
            <Text>Рестарты:</Text>
            <Text color={APP_COLORS.RED}>{worker.restartAttempts}</Text>
          </HStack>
        )}
        <HStack spacing={1}>
          <Text>WebRTC:</Text>
          <Badge
            size="sm"
            colorScheme={worker.webRtcServerAlive ? 'green' : 'red'}
          >
            {worker.webRtcServerAlive ? 'ok' : 'down'}
          </Badge>
        </HStack>
      </VStack>
    </Box>
  );
};

const ServerInfo = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(() => {
    setLoading(true);
    WS.send({ type: 'getStats' });
  }, []);

  useEffect(() => {
    fetchStats();

    return WS.subscribe((data) => {
      if (data.type === 'serverStats') {
        setStats(data.data);
        setLoading(false);
      }
    });
  }, [fetchStats]);

  if (loading && !stats) {
    return (
      <Flex
        justify="center"
        align="center"
        py={10}
      >
        <Spinner
          color={APP_COLORS.BLURPLE}
          size="lg"
        />
      </Flex>
    );
  }

  if (!stats) return null;

  const healthPercent = stats.totalWorkers > 0 ? Math.round((stats.activeWorkers / stats.totalWorkers) * 100) : 0;

  return (
    <VStack
      spacing={4}
      align="stretch"
    >
      <Flex
        justify="space-between"
        align="center"
      >
        <Text
          fontSize="xs"
          color={APP_COLORS.TEXT_SECONDARY}
        >
          {APP_NAME} server info
        </Text>
        <Tooltip label="Обновить">
          <IconButton
            icon={<IoMdRefresh />}
            size="sm"
            variant="ghost"
            color={APP_COLORS.TEXT_SECONDARY}
            _hover={{ color: APP_COLORS.BLURPLE }}
            onClick={fetchStats}
            isLoading={loading}
            aria-label="Обновить статистику"
          />
        </Tooltip>
      </Flex>

      <Box>
        <Flex
          justify="space-between"
          mb={1}
        >
          <Text
            fontSize="xs"
            color={APP_COLORS.TEXT_SECONDARY}
          >
            Здоровье кластера
          </Text>
          <Text
            fontSize="xs"
            fontWeight="bold"
            color={healthPercent === 100 ? APP_COLORS.GREEN : APP_COLORS.RED}
          >
            {healthPercent}%
          </Text>
        </Flex>
        <Progress
          value={healthPercent}
          size="sm"
          borderRadius="full"
          colorScheme={healthPercent === 100 ? 'green' : healthPercent > 50 ? 'yellow' : 'red'}
          bg={APP_COLORS.BACKGROUND_TERTIARY}
        />
      </Box>

      <Flex
        gap={3}
        flexWrap="wrap"
      >
        <StatCard
          label="Workers"
          value={stats.activeWorkers}
          color={APP_COLORS.GREEN}
        />
        <StatCard
          label="Акт. комнаты"
          value={stats.totalRooms}
          color={APP_COLORS.BLURPLE}
        />
        <StatCard
          label="Routers"
          value={stats.totalRouters}
        />
      </Flex>

      {stats.deadWorkers.length > 0 && (
        <Box
          bg="rgba(237, 66, 69, 0.1)"
          borderRadius="md"
          p={3}
          border="1px solid"
          borderColor={APP_COLORS.RED}
        >
          <Text
            fontSize="sm"
            color={APP_COLORS.RED}
            fontWeight="semibold"
          >
            Dead workers: {stats.deadWorkers.join(', ')}
          </Text>
        </Box>
      )}

      <Box>
        <Text
          fontSize="xs"
          color={APP_COLORS.TEXT_SECONDARY}
          textTransform="uppercase"
          letterSpacing="wide"
          mb={2}
        >
          Workers ({stats.workers.length})
        </Text>
        <VStack
          spacing={2}
          align="stretch"
        >
          {stats?.workers.map((w) => (
            <WorkerRow
              key={w.index}
              worker={w}
            />
          ))}
        </VStack>
      </Box>
    </VStack>
  );
};

export default ServerInfo;
